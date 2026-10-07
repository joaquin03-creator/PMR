// ═══════════════════════════════════════════════════════════════════
// TICKET OUTBOX — a completed buy ticket must never be lost.
//
// The ticket flow prints first and saves in the background. Until the
// server confirms the ticket, the only copies are in this page's memory
// and in Firestore's own pending-write queue; if the page is refreshed
// or dies before that queue has stored it, the ticket is gone even
// though the customer was paid. That actually happened (2026-10-06).
//
// So every completed ticket is first written HERE (its own small
// IndexedDB database, independent of Firestore's cache), then sent.
// The entry is removed only when the ticket and its follow-up writes
// are done. On the next app load, anything still here is checked
// against the server and re-sent ("backfilled") with the SAME ticket id
// and the ORIGINAL transaction timestamp.
//
// No-double-count rule: follow-up writes (customer update, inventory
// increments, audit entries) are only ever issued AFTER the server has
// confirmed the ticket, and each group is flagged in the entry BEFORE
// it is issued. On replay, a group flagged as issued is never re-sent.
// ═══════════════════════════════════════════════════════════════════

import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  increment,
  getDocFromServer,
  waitForPendingWrites
} from 'firebase/firestore';
import { db } from '../firebase';
import { logAuditEvent } from './audit';

export interface TicketOutboxEntry {
  ticketId: string;
  savedAt: string;
  /** The full buyTickets document, exactly as it must be stored (photos included). */
  ticketData: Record<string, any>;
  customerId: string;
  customerName: string;
  /** Set only when this ticket also creates the customer. */
  newCustomerData: Record<string, any> | null;
  customerUpdate: Record<string, any>;
  inventory: { materialId: string; netWeight: number }[];
  overrides: { materialName: string; before: number; after: number }[];
  draftId: string | null;
  auditNote: string;
  ticketConfirmed: boolean;
  issued: { customerUpdate: boolean; inventory: boolean; audit: boolean; draft: boolean };
  attempts: number;
  lastError?: string;
}

const DB_NAME = 'pmr-ticket-outbox';
const STORE = 'tickets';
// Deliberately NOT a `pm_draft_` key: those are purged by clearAllPrunableStorage().
const LS_PREFIX = 'pm_outbox_ticket_';

// Tickets this page is saving right now -- replay must leave them alone.
const liveTicketIds = new Set<string>();

const PHOTO_FIELDS = ['customerPhotoUrl', 'vehiclePhotoUrl', 'loadPhotoUrl', 'idImageUrl', 'signatureUrl', 'fingerprintUrl'];

/**
 * Copy of a ticket for the AUDIT LOG with embedded photos replaced by a marker.
 * The ticket record itself keeps every photo; the audit entry does not need a
 * second ~200 KB copy of them (300 of those were loading on the Cash Drawer screen).
 */
export function stripPhotosForAudit(ticketData: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...ticketData };
  for (const f of PHOTO_FIELDS) {
    if (typeof out[f] === 'string' && out[f].startsWith('data:')) out[f] = '[photo stored on ticket record]';
  }
  if (Array.isArray(out.materials)) {
    out.materials = out.materials.map((m: any) =>
      m && typeof m.photoUrl === 'string' && m.photoUrl.startsWith('data:')
        ? { ...m, photoUrl: '[photo stored on ticket record]' }
        : m
    );
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'ticketId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    } catch (e) {
      reject(e);
    }
  });
}

async function idbRun<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> {
  const idb = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = idb.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      let result: T | undefined;
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  } finally {
    idb.close();
  }
}

/**
 * Durably store the ticket before anything is sent or printed.
 * Bounded: this can never hang the ticket flow. Returns false if the copy could not be stored.
 */
export async function saveOutboxEntry(entry: TicketOutboxEntry, timeoutMs = 2000): Promise<boolean> {
  try {
    await withTimeout(idbRun('readwrite', (s) => s.put(entry)), timeoutMs, 'Ticket safety copy');
    return true;
  } catch (idbErr) {
    console.warn('[TicketOutbox] IndexedDB save failed, falling back to localStorage:', idbErr);
    try {
      localStorage.setItem(LS_PREFIX + entry.ticketId, JSON.stringify(entry));
      return true;
    } catch (lsErr) {
      console.error('[TicketOutbox] Could not store a safety copy of the ticket:', lsErr);
      return false;
    }
  }
}

async function updateEntry(entry: TicketOutboxEntry): Promise<void> {
  try {
    await withTimeout(idbRun('readwrite', (s) => s.put(entry)), 2000, 'Ticket safety copy update');
  } catch {
    try { localStorage.setItem(LS_PREFIX + entry.ticketId, JSON.stringify(entry)); } catch { /* best effort */ }
  }
}

async function removeEntry(ticketId: string): Promise<void> {
  try {
    await withTimeout(idbRun('readwrite', (s) => s.delete(ticketId)), 2000, 'Ticket safety copy removal');
  } catch (e) {
    console.warn('[TicketOutbox] Could not remove outbox entry', ticketId, e);
  }
  try { localStorage.removeItem(LS_PREFIX + ticketId); } catch { /* ignore */ }
}

export async function listOutboxEntries(): Promise<TicketOutboxEntry[]> {
  const byId = new Map<string, TicketOutboxEntry>();
  try {
    const all = await withTimeout(idbRun<TicketOutboxEntry[]>('readonly', (s) => s.getAll()), 4000, 'Ticket outbox read');
    (all || []).forEach((e) => byId.set(e.ticketId, e));
  } catch (e) {
    console.warn('[TicketOutbox] IndexedDB read failed:', e);
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) {
        const parsed = JSON.parse(localStorage.getItem(k) || 'null');
        if (parsed && parsed.ticketId && !byId.has(parsed.ticketId)) byId.set(parsed.ticketId, parsed);
      }
    }
  } catch { /* ignore */ }
  return [...byId.values()];
}

export interface TicketWrites {
  ticketPromise: Promise<void>;
  newCustomerPromise: Promise<void> | null;
}

/** Fire the ticket write (and new-customer write) immediately. Does not wait for anything. */
export function fireTicketWrites(entry: TicketOutboxEntry): TicketWrites {
  liveTicketIds.add(entry.ticketId);
  const newCustomerPromise = entry.newCustomerData
    ? setDoc(doc(db, 'customers', entry.customerId), entry.newCustomerData)
    : null;
  const ticketPromise = setDoc(doc(db, 'buyTickets', entry.ticketId), entry.ticketData);
  // The ticket is complete: remove its autosave draft right away. Safe even if this page
  // dies now -- the ticket itself is held in the outbox -- and deleting twice is harmless.
  if (entry.draftId) {
    deleteDoc(doc(db, 'ticketDrafts', entry.draftId)).catch((e) => console.warn('[TicketOutbox] Draft cleanup failed:', e));
  }
  // Never leave these as unhandled rejections; finishTicket() reports the outcome.
  ticketPromise.catch(() => {});
  newCustomerPromise?.catch(() => {});
  return { ticketPromise, newCustomerPromise };
}

export interface FinishResult {
  ok: boolean;
  /** Set when the server REJECTED the ticket itself. The outbox entry is kept. */
  error?: string;
  /** A follow-up write (customer / inventory) failed; the ticket itself is saved. */
  followUpFailed?: boolean;
}

/**
 * Wait for the server to confirm the ticket, then issue the follow-up writes.
 * Runs in the background -- nothing on screen waits on it. While offline the
 * ticket promise simply stays pending and this resumes when the device reconnects.
 */
export async function finishTicket(entry: TicketOutboxEntry, writes: TicketWrites): Promise<FinishResult> {
  liveTicketIds.add(entry.ticketId);
  try {
    if (!entry.ticketConfirmed) {
      try {
        await writes.ticketPromise;
      } catch (ticketErr: any) {
        entry.attempts = (entry.attempts || 0) + 1;
        entry.lastError = String(ticketErr?.message || ticketErr);
        await updateEntry(entry);
        console.error('[TicketOutbox] Server rejected ticket', entry.ticketId, ticketErr);
        return { ok: false, error: entry.lastError };
      }
      entry.ticketConfirmed = true;
      await updateEntry(entry);
    }

    let followUpFailed = false;

    if (writes.newCustomerPromise) {
      try { await writes.newCustomerPromise; } catch (e) { console.warn('[TicketOutbox] New customer write failed:', e); followUpFailed = true; }
    }

    if (!entry.issued.customerUpdate && Object.keys(entry.customerUpdate || {}).length > 0) {
      entry.issued.customerUpdate = true;
      await updateEntry(entry);
      try {
        await updateDoc(doc(db, 'customers', entry.customerId), { ...entry.customerUpdate, updatedAt: new Date().toISOString() });
      } catch (e) {
        console.warn('[TicketOutbox] Customer update failed:', e);
        followUpFailed = true;
      }
    }

    if (!entry.issued.inventory && entry.inventory.length > 0) {
      entry.issued.inventory = true;
      await updateEntry(entry);
      // Issue every increment together, then wait -- so they are all in the pending queue at once.
      const results = await Promise.allSettled(
        entry.inventory.map((item) =>
          setDoc(
            doc(db, 'inventory', item.materialId),
            { materialId: item.materialId, currentWeight: increment(item.netWeight), lastUpdated: new Date().toISOString() },
            { merge: true }
          )
        )
      );
      if (results.some((r) => r.status === 'rejected')) {
        console.warn('[TicketOutbox] One or more inventory increments failed for', entry.ticketId, results);
        followUpFailed = true;
      }
    }

    if (!entry.issued.audit) {
      entry.issued.audit = true;
      await updateEntry(entry);
      await logAuditEvent('buyTicket', entry.ticketId, 'create', { after: stripPhotosForAudit(entry.ticketData) }, entry.auditNote);
      for (const o of entry.overrides) {
        await logAuditEvent(
          'buyTicket',
          entry.ticketId,
          'override',
          { before: { price: o.before }, after: { price: o.after } },
          `Price override approved for ${o.materialName} in Quick Ticket #${entry.ticketId.toUpperCase()}: $${o.before.toFixed(2)}/lb to $${o.after.toFixed(2)}/lb`
        );
      }
    }

    if (!entry.issued.draft && entry.draftId) {
      entry.issued.draft = true;
      await updateEntry(entry);
      try { await deleteDoc(doc(db, 'ticketDrafts', entry.draftId)); } catch (e) { console.warn('[TicketOutbox] Draft cleanup failed:', e); }
    }

    await removeEntry(entry.ticketId);
    return { ok: true, followUpFailed };
  } finally {
    liveTicketIds.delete(entry.ticketId);
  }
}

let replayRunning = false;

/**
 * Re-send any completed ticket that never reached the server (page refreshed, crashed
 * or closed mid-save). Safe to call repeatedly; does nothing when the outbox is empty.
 */
export async function replayTicketOutbox(): Promise<{ recovered: string[]; failed: { ticketId: string; error: string }[] }> {
  const outcome = { recovered: [] as string[], failed: [] as { ticketId: string; error: string }[] };
  if (replayRunning) return outcome;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return outcome;
  replayRunning = true;
  try {
    const entries = (await listOutboxEntries()).filter((e) => !liveTicketIds.has(e.ticketId));
    if (entries.length === 0) return outcome;

    // Let Firestore flush whatever it already had queued from the previous page, so the
    // server check below is authoritative and nothing is sent twice.
    try {
      await withTimeout(waitForPendingWrites(db), 60000, 'Pending writes');
    } catch (e) {
      console.warn('[TicketOutbox] Pending writes not flushed yet; will retry replay later.', e);
      return outcome;
    }

    for (const entry of entries) {
      if (liveTicketIds.has(entry.ticketId)) continue;
      if ((entry.attempts || 0) >= 5) {
        // The server keeps rejecting it. Stop retrying, keep the copy, keep telling a manager.
        outcome.failed.push({ ticketId: entry.ticketId, error: entry.lastError || 'rejected repeatedly' });
        continue;
      }
      try {
        const snap = await withTimeout(getDocFromServer(doc(db, 'buyTickets', entry.ticketId)), 60000, 'Ticket lookup');
        if (snap.exists()) {
          // Ticket is on the server; finish only the follow-ups that were never issued.
          entry.ticketConfirmed = true;
          const res = await finishTicket(entry, { ticketPromise: Promise.resolve(), newCustomerPromise: null });
          if (!res.ok) outcome.failed.push({ ticketId: entry.ticketId, error: res.error || 'unknown' });
        } else if (entry.ticketConfirmed) {
          // It was confirmed once and is gone now: someone deleted it. Do not recreate it.
          await removeEntry(entry.ticketId);
        } else {
          const res = await finishTicket(entry, fireTicketWrites(entry));
          if (res.ok) outcome.recovered.push(entry.ticketId);
          else outcome.failed.push({ ticketId: entry.ticketId, error: res.error || 'unknown' });
        }
      } catch (e: any) {
        console.warn('[TicketOutbox] Replay of', entry.ticketId, 'did not finish; will retry later.', e);
      }
    }
    return outcome;
  } finally {
    replayRunning = false;
  }
}
