// ═══════════════════════════════════════════════════════════════════
// LEDGER ROWS — one row per day for the Historical Ledgers table.
//
// Pure functions, no I/O. This file contains NO new money math: every
// figure is either a stored value or produced by the locked functions
// in cashLogicLock.ts, from the same components the in-day cash sheet
// uses:
//   Money In   = cashTransactions (type 'inflow') for the session
//   Money Out  = cashTransactions (type 'expense') for the session
//              + buyTickets dated that day that were paid from the drawer
//                (not voided/cancelled, isCashPayoutTicket)
//   Expected   = calculateExpectedCash(Starting, Money In, payouts, expenses)
//   Over/Short = calculateOverShort(Final Count, Expected)
//
// Rows are shown HONESTLY. Over/Short is recomputed from the components
// so each row ties out; when the value stored on the session record
// disagrees, the row says so (`storedOverShortDiffers`) instead of hiding
// it. Nothing here writes or corrects anything.
// ═══════════════════════════════════════════════════════════════════

import { calculateExpectedCash, calculateOverShort, isCashPayoutTicket, roundMoney } from './cashLogicLock';
import { getClosingBasis, isProvisionalSession } from './provisionalCash';

export interface LedgerSessionInput {
  id: string;
  date: string; // YYYY-MM-DD
  status: 'open' | 'closed' | 'provisional';
  openingCash: number;
  expectedCash?: number;
  actualCash?: number | null;
  overShort?: number | null;
  provisionalAssumedCash?: number | null;
}

export interface LedgerTransactionInput {
  sessionId: string;
  type: 'inflow' | 'expense';
  amount: number;
}

export interface LedgerTicketInput {
  timestamp?: string;
  status?: string;
  paymentMethod?: string | null;
  totalAmount?: number;
}

export interface LedgerRow {
  key: string;
  date: string;
  sessionId: string | null;
  /** 'none' = tickets were written that day but no cash session exists. */
  status: 'open' | 'closed' | 'provisional' | 'none';
  startingCount: number | null;
  /** null = that session's transactions are not loaded yet. */
  moneyIn: number | null;
  /** payouts + expenses. null = that day's tickets (or transactions) are not loaded yet. */
  moneyOut: number | null;
  payouts: number | null;
  expenses: number | null;
  ticketCount: number | null;
  expected: number | null;
  finalCount: number | null;
  /** counted = a physical count; assumed = provisional close figure; none = not counted. */
  finalKind: 'counted' | 'assumed' | 'none';
  overShort: number | null;
  /** value = a real variance; pending = no physical count yet; unknown = components not loaded. */
  overShortState: 'value' | 'pending' | 'unknown';
  storedOverShort: number | null;
  storedOverShortDiffers: boolean;
  /** Set when Starting Count differs from the prior day's Final Count by more than one cent. */
  carryForward: { priorDate: string; priorFinal: number; difference: number } | null;
}

export interface BuildLedgerRowsInput {
  sessions: LedgerSessionInput[];
  transactions: LedgerTransactionInput[];
  /** False until the transactions for these sessions have been loaded. */
  transactionsLoaded: boolean;
  tickets: LedgerTicketInput[];
  /** Tickets are fully loaded for every day on or after this local date (YYYY-MM-DD). */
  ticketsLoadedFromDate: string;
  /** Maps a ticket timestamp to its local YYYY-MM-DD day -- the same function the day sheet uses. */
  toLocalDate: (timestamp?: string) => string;
}

export function buildLedgerRows(input: BuildLedgerRowsInput): LedgerRow[] {
  const { sessions, transactions, transactionsLoaded, tickets, ticketsLoadedFromDate, toLocalDate } = input;

  // Drawer payouts per local day (same exclusions as the in-day sheet).
  const payoutsByDate = new Map<string, { total: number; count: number }>();
  for (const t of tickets) {
    if (t.status === 'voided' || t.status === 'cancelled') continue;
    const day = toLocalDate(t.timestamp);
    if (!day) continue;
    const entry = payoutsByDate.get(day) || { total: 0, count: 0 };
    entry.count += 1;
    if (isCashPayoutTicket(t.paymentMethod)) entry.total += t.totalAmount || 0;
    payoutsByDate.set(day, entry);
  }

  const txBySession = new Map<string, { inflow: number; expense: number }>();
  for (const tx of transactions) {
    const entry = txBySession.get(tx.sessionId) || { inflow: 0, expense: 0 };
    if (tx.type === 'inflow') entry.inflow += tx.amount || 0;
    else if (tx.type === 'expense') entry.expense += tx.amount || 0;
    txBySession.set(tx.sessionId, entry);
  }

  const sortedSessions = [...sessions].filter(s => s.date).sort((a, b) => b.date.localeCompare(a.date));
  const rows: LedgerRow[] = [];

  sortedSessions.forEach((session, index) => {
    const ticketsLoaded = session.date >= ticketsLoadedFromDate;
    const tx = txBySession.get(session.id) || { inflow: 0, expense: 0 };
    const moneyIn = transactionsLoaded ? roundMoney(tx.inflow) : null;
    const expenses = transactionsLoaded ? roundMoney(tx.expense) : null;
    const dayPayouts = payoutsByDate.get(session.date);
    const payouts = ticketsLoaded ? roundMoney(dayPayouts?.total || 0) : null;
    const moneyOut = payouts !== null && expenses !== null ? roundMoney(payouts + expenses) : null;
    const expected = moneyIn !== null && payouts !== null && expenses !== null
      ? calculateExpectedCash(session.openingCash, moneyIn, payouts, expenses)
      : null;

    const provisional = isProvisionalSession(session);
    let finalCount: number | null = null;
    let finalKind: LedgerRow['finalKind'] = 'none';
    if (provisional) {
      finalCount = getClosingBasis(session) ?? null;
      finalKind = finalCount !== null ? 'assumed' : 'none';
    } else if (session.status === 'closed' && session.actualCash !== undefined && session.actualCash !== null) {
      finalCount = session.actualCash;
      finalKind = 'counted';
    }

    let overShort: number | null = null;
    let overShortState: LedgerRow['overShortState'] = 'pending';
    if (finalKind === 'counted') {
      if (expected !== null) {
        overShort = calculateOverShort(finalCount as number, expected);
        overShortState = 'value';
      } else {
        overShortState = 'unknown';
      }
    }

    const storedOverShort = !provisional && session.status === 'closed' && session.overShort !== undefined && session.overShort !== null
      ? session.overShort
      : null;
    const storedOverShortDiffers = overShort !== null && storedOverShort !== null && Math.abs(overShort - storedOverShort) > 0.01;

    // Carry-forward: compare with the chronologically prior session's Final Count.
    let carryForward: LedgerRow['carryForward'] = null;
    const prior = sortedSessions[index + 1];
    if (prior) {
      const priorFinal = prior.status === 'open' ? undefined : getClosingBasis(prior);
      if (priorFinal !== undefined && priorFinal !== null) {
        const difference = roundMoney(session.openingCash - priorFinal);
        if (Math.abs(difference) > 0.01) {
          carryForward = { priorDate: prior.date, priorFinal, difference };
        }
      }
    }

    rows.push({
      key: session.id,
      date: session.date,
      sessionId: session.id,
      status: session.status,
      startingCount: session.openingCash,
      moneyIn,
      moneyOut,
      payouts,
      expenses,
      ticketCount: ticketsLoaded ? (dayPayouts?.count || 0) : null,
      expected,
      finalCount,
      finalKind,
      overShort,
      overShortState,
      storedOverShort,
      storedOverShortDiffers,
      carryForward
    });
  });

  // Days with drawer payouts but no cash session at all: shown in date order, nothing invented.
  const sessionDates = new Set(sortedSessions.map(s => s.date));
  payoutsByDate.forEach((entry, date) => {
    if (sessionDates.has(date) || date < ticketsLoadedFromDate) return;
    rows.push({
      key: `no-session-${date}`,
      date,
      sessionId: null,
      status: 'none',
      startingCount: null,
      moneyIn: null,
      moneyOut: roundMoney(entry.total),
      payouts: roundMoney(entry.total),
      expenses: null,
      ticketCount: entry.count,
      expected: null,
      finalCount: null,
      finalKind: 'none',
      overShort: null,
      overShortState: 'pending',
      storedOverShort: null,
      storedOverShortDiffers: false,
      carryForward: null
    });
  });

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
