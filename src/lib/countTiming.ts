// ═══════════════════════════════════════════════════════════════════
// COUNT TIMING — was the drawer counted before the day's last payout?
//
// A closing count entered while tickets are still being paid (10/16,
// 10/17 and 10/19/2026) is too high by whatever was paid after it, and
// that amount then shows up as "over" one day and "short" the next.
// The close step uses this to point it out. Display/notice only: it
// changes no cash figure and blocks nothing.
// ═══════════════════════════════════════════════════════════════════

import { isCashPayoutTicket, roundMoney, DENOMINATION_FACE_VALUES, type DenominationBreakdown } from './cashLogicLock';

interface TicketLike {
  id: string;
  timestamp?: string;
  status?: string;
  paymentMethod?: string | null;
  totalAmount?: number;
}

/** Cash tickets (not voided/cancelled) written after the count was last changed. */
export function ticketsAfterCount<T extends TicketLike>(tickets: T[], countedAt?: string | null): { tickets: T[]; total: number } {
  const at = countedAt ? new Date(countedAt).getTime() : NaN;
  if (isNaN(at)) return { tickets: [], total: 0 };
  const late = tickets
    .filter((t) => t.status !== 'voided' && t.status !== 'cancelled' && isCashPayoutTicket(t.paymentMethod))
    .filter((t) => {
      const ts = t.timestamp ? new Date(t.timestamp).getTime() : NaN;
      return !isNaN(ts) && ts > at;
    })
    .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  return { tickets: late, total: roundMoney(late.reduce((s, t) => s + (t.totalAmount || 0), 0)) };
}

/** Same amount in every denomination (missing = 0). */
export function sameDenominations(a?: DenominationBreakdown | null, b?: DenominationBreakdown | null): boolean {
  return (Object.keys(DENOMINATION_FACE_VALUES) as (keyof DenominationBreakdown)[]).every(
    (k) => Math.abs((Number(a?.[k]) || 0) - (Number(b?.[k]) || 0)) < 0.001
  );
}
