// ═══════════════════════════════════════════════════════════════════
// REDO WITH NEW PRICE — replace a completed ticket with a corrected one.
//
// Shop practice: when a repeat customer's price was forgotten, the ticket
// is rung up again with the right price and the customer is paid only the
// difference. The drawer is right only if the first ticket is then voided:
// both tickets left completed count the first payout twice (10/20/2026,
// BUY-20261020-153623, $48.96 shown as "over").
//
// So a redo ticket carries `redoOf`. Once the server has confirmed the new
// ticket, the outbox voids the original (status, inventory reversal and
// audit entry in ONE transaction that first checks the original is still
// completed -- so a retry can never reverse inventory twice). The new
// ticket's totalAmount is its full payout, like any ticket; nothing in the
// cash formulas changes. The printout says how much is left to pay.
// ═══════════════════════════════════════════════════════════════════

import { collection, doc, increment, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { roundMoney } from './cashLogicLock';
import { getEasternDateParts } from './utils';
import type { BuyTicket, BuyTicketMaterial } from '../types';

export interface RedoOf {
  ticketId: string;
  /** What was already paid out on the original ticket. */
  totalAmount: number;
  timestamp: string;
  /** Inventory the original added, to take back out when it is voided. */
  inventory: { materialId: string; netWeight: number }[];
}

/** `materials` = the lines as they count now (pass withEffectiveMaterials(...) when reclassified). */
export function buildRedoOf(ticket: Pick<BuyTicket, 'id' | 'totalAmount' | 'timestamp'>, materials: BuyTicketMaterial[]): RedoOf {
  return {
    ticketId: ticket.id,
    totalAmount: roundMoney(ticket.totalAmount || 0),
    timestamp: ticket.timestamp,
    inventory: materials
      .filter((m) => m.materialId)
      .map((m) => ({ materialId: m.materialId, netWeight: Number(m.netWeight) || 0 }))
  };
}

/** Left to pay on the replacement ticket (negative = the customer was overpaid by that much). */
export function redoDifference(newTotal: number, priorPayout: number): number {
  return roundMoney((Number(newTotal) || 0) - (Number(priorPayout) || 0));
}

function easternDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = getEasternDateParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * A ticket can be redone only on the day it was written (Eastern), while it is still completed and
 * not already redone. Voiding an EARLIER day's ticket would raise that day's expected cash after the
 * fact although its payout really happened then -- for an older ticket, pay the difference as a
 * drawer expense ("Ticket adjustment") instead.
 */
export function canRedoTicket(ticket: Pick<BuyTicket, 'status' | 'timestamp' | 'replacedByTicketId'>, now: Date = new Date()): boolean {
  return (ticket.status || 'completed') === 'completed'
    && !ticket.replacedByTicketId
    && easternDay(ticket.timestamp) === easternDay(now.toISOString());
}

const weightKey = (gross: number, tare: number) => `${Number(gross) || 0}|${Number(tare) || 0}`;

/**
 * A completed ticket for this customer, from today, whose weights match the ticket being
 * written (at least half of the lines with a weight, by gross and tare) -- i.e. most likely
 * the same load rung up again. Returns the newest one, or null.
 */
export function findLikelyRedoSource(
  items: { gross: number; tare: number }[],
  candidates: BuyTicket[],
  now: Date = new Date()
): BuyTicket | null {
  const weighed = items.filter((i) => (Number(i.gross) || 0) > 0);
  if (weighed.length === 0) return null;
  const today = easternDay(now.toISOString());
  const sorted = [...candidates].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  for (const t of sorted) {
    if ((t.status || 'completed') !== 'completed') continue;
    if (easternDay(t.timestamp) !== today) continue;
    const pool = new Map<string, number>();
    for (const m of t.materials || []) {
      const k = weightKey(m.grossWeight, m.tareWeight);
      pool.set(k, (pool.get(k) || 0) + 1);
    }
    let matched = 0;
    for (const i of weighed) {
      const k = weightKey(i.gross, i.tare);
      const left = pool.get(k) || 0;
      if (left > 0) {
        matched += 1;
        pool.set(k, left - 1);
      }
    }
    if (matched > 0 && matched * 2 >= weighed.length) return t;
  }
  return null;
}

export type VoidOriginalOutcome = 'voided' | 'already-void' | 'missing';

/**
 * Void the ticket a redo replaced: status, inventory reversal and the audit entry together,
 * only if it is still completed. Safe to retry. Needs a connection (transactions do).
 */
export async function voidRedoneOriginal(
  redoOf: RedoOf,
  replacementTicketId: string,
  performedBy: string
): Promise<VoidOriginalOutcome> {
  const ticketRef = doc(db, 'buyTickets', redoOf.ticketId);
  // Fixed id: the audit collection never allows updates, so this can only ever be written once.
  const auditRef = doc(collection(db, 'auditLogs'), `redo_void_${redoOf.ticketId}`);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ticketRef);
    if (!snap.exists()) return 'missing';
    const status = (snap.data().status as string) || 'completed';
    if (status === 'voided' || status === 'cancelled') return 'already-void';

    const now = new Date().toISOString();
    const reason = `Redone with new price as #${replacementTicketId.toUpperCase()}`;
    tx.update(ticketRef, {
      status: 'voided',
      voidedAt: now,
      voidedBy: performedBy,
      voidReason: reason,
      replacedByTicketId: replacementTicketId
    });
    for (const item of redoOf.inventory) {
      tx.set(
        doc(db, 'inventory', item.materialId),
        { materialId: item.materialId, currentWeight: increment(-item.netWeight), lastUpdated: now },
        { merge: true }
      );
    }
    tx.set(auditRef, {
      entityType: 'buyTicket',
      entityId: redoOf.ticketId,
      action: 'void',
      changes: {
        before: { status },
        after: { status: 'voided', replacedByTicketId: replacementTicketId }
      },
      performedBy,
      timestamp: now,
      notes: `Voided Buy Ticket #${redoOf.ticketId.toUpperCase()} (Total payout: $${redoOf.totalAmount.toFixed(2)}). ${reason}; the customer is paid the difference.`
    });
    return 'voided';
  });
}
