import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { logAuditEvent } from './audit';
import { roundMoney } from './cashLogicLock';
import { BuyTicket, CashSession, AfterHoursDay, AfterHoursNote } from '../types';

export type { AfterHoursDay, AfterHoursNote };

/**
 * Extracts the YYYY-MM-DD local date string from an ISO or standard timestamp string.
 * Uses the exact same local conversion as getTicketLocalDate in CashDrawer.tsx:
 * new Date(timestampStr).toLocaleDateString('en-CA')
 */
export function getLocalDateFromTimestamp(timestampStr?: string): string {
  if (!timestampStr) return '';
  const d = new Date(timestampStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA');
}

/**
 * Detects buy tickets that were completed on a calendar day where NO cash session
 * exists (in any status — 'open', 'closed', or 'provisional').
 *
 * If ANY cash session exists for that date, tickets are considered part of that session
 * day and are therefore NOT after-hours.
 *
 * @param buyTickets List of buy tickets
 * @param sessions List of cash drawer sessions across all statuses
 * @param notesMap Optional map of notes keyed by date (e.g. Record<YYYY-MM-DD, { note?: string }>)
 * @returns Array of AfterHoursDay objects sorted by date descending
 */
export function getAfterHoursActivity(
  buyTickets: BuyTicket[],
  sessions: CashSession[],
  notesMap?: Record<string, { note?: string } | string | null | undefined>
): AfterHoursDay[] {
  // 1. Build a set of all dates that have a cashSession in ANY status
  const sessionDates = new Set<string>();
  for (const session of sessions) {
    if (session && session.date) {
      sessionDates.add(session.date.trim());
    }
  }

  // 2. Filter completed buyTickets (status === 'completed', excluding voided/cancelled)
  const completedTickets = buyTickets.filter(
    ticket => ticket && ticket.status === 'completed'
  );

  // 3. Group by local transaction date for dates NOT in sessionDates
  const dayGroups = new Map<string, { count: number; rawAmount: number; ticketIds: string[] }>();

  for (const ticket of completedTickets) {
    const localDate = getLocalDateFromTimestamp(ticket.timestamp);
    if (!localDate) continue;

    // If a session exists for this date in any status, it's not after-hours
    if (sessionDates.has(localDate)) continue;

    let group = dayGroups.get(localDate);
    if (!group) {
      group = { count: 0, rawAmount: 0, ticketIds: [] };
      dayGroups.set(localDate, group);
    }

    group.count += 1;
    const ticketAmount = typeof ticket.totalAmount === 'number' && !isNaN(ticket.totalAmount)
      ? ticket.totalAmount
      : 0;
    group.rawAmount += ticketAmount;
    if (ticket.id) {
      group.ticketIds.push(ticket.id);
    }
  }

  // 4. Transform into AfterHoursDay entries using locked roundMoney
  const results: AfterHoursDay[] = [];

  for (const [date, group] of dayGroups.entries()) {
    const noteEntry = notesMap ? notesMap[date] : undefined;
    const noteContent = typeof noteEntry === 'string'
      ? noteEntry
      : (noteEntry && typeof noteEntry.note === 'string' ? noteEntry.note : undefined);

    const authorEmail = noteEntry && typeof noteEntry === 'object' && 'createdBy' in noteEntry && typeof (noteEntry as any).createdBy === 'string'
      ? (noteEntry as any).createdBy
      : (noteEntry && typeof noteEntry === 'object' && 'authorEmail' in noteEntry && typeof (noteEntry as any).authorEmail === 'string' ? (noteEntry as any).authorEmail : undefined);

    const hasNote = Boolean(noteContent && noteContent.trim().length > 0);

    results.push({
      date,
      ticketCount: group.count,
      totalAmount: roundMoney(group.rawAmount),
      ticketIds: group.ticketIds,
      hasNote,
      ...(hasNote ? { note: noteContent!.trim() } : {}),
      ...(authorEmail ? { authorEmail } : {})
    });
  }

  // 5. Sort results by date descending
  results.sort((a, b) => b.date.localeCompare(a.date));

  return results;
}

/**
 * Retrieves the after-hours note for a specific date if it exists.
 */
export async function getAfterHoursNote(date: string): Promise<AfterHoursNote | null> {
  try {
    const docRef = doc(db, 'afterHoursNotes', date);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as AfterHoursNote;
  } catch (error) {
    console.error(`Failed to get after-hours note for ${date}:`, error);
    return null;
  }
}

/**
 * Saves or updates an after-hours note for a given date in the 'afterHoursNotes' collection
 * and writes an append-only audit event via logAuditEvent.
 *
 * @param date The date string in YYYY-MM-DD format
 * @param note The text note for that date
 * @param user The user identifier or object (e.g. user email)
 */
export async function saveAfterHoursNote(
  date: string,
  note: string,
  user: string | { email?: string }
): Promise<void> {
  const userEmail = (typeof user === 'string' ? user : user?.email) || 'unknown';
  const docRef = doc(db, 'afterHoursNotes', date);
  const snap = await getDoc(docRef);
  const now = new Date().toISOString();
  const trimmedNote = note.trim();

  if (snap.exists()) {
    const existing = snap.data() as Partial<AfterHoursNote>;
    await updateDoc(docRef, {
      note: trimmedNote,
      updatedAt: now
    });

    await logAuditEvent(
      'afterHoursNote',
      date,
      'update',
      {
        before: { note: existing.note, updatedAt: existing.updatedAt },
        after: { note: trimmedNote, updatedAt: now }
      },
      `After-hours note added/updated for ${date} by ${userEmail}`
    );
  } else {
    const newDoc: AfterHoursNote = {
      date,
      note: trimmedNote,
      createdBy: userEmail,
      createdAt: now,
      updatedAt: now
    };
    await setDoc(docRef, newDoc);

    await logAuditEvent(
      'afterHoursNote',
      date,
      'create',
      {
        before: null,
        after: newDoc
      },
      `After-hours note added/updated for ${date} by ${userEmail}`
    );
  }
}
