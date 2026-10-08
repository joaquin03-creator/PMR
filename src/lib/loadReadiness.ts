import { MaterialInventorySheet } from '../types';

export const FULL_LOAD_TARGET_LBS = 36000;
export const BUYER_LOCK_THRESHOLD_LBS = 27000; // 75% of a full load
export const FULFILLMENT_WINDOW_DAYS = 30;

export interface MaterialReadinessLine {
  materialId: string;
  netLbs: number;
}

/** Net lbs currently boxed per material, from a sheet's rows. */
export function computeNetTotalsByMaterial(sheet: MaterialInventorySheet | null): MaterialReadinessLine[] {
  if (!sheet) return [];
  const totals = new Map<string, number>();
  sheet.rows.forEach(row => {
    if (!row.materialId) return;
    totals.set(row.materialId, (totals.get(row.materialId) || 0) + (row.net || 0));
  });
  return Array.from(totals.entries()).map(([materialId, netLbs]) => ({ materialId, netLbs }));
}

/** Sum of every row's net weight on a sheet. */
export function computeSheetNetTotal(sheet: MaterialInventorySheet | null): number {
  if (!sheet) return 0;
  return sheet.rows.reduce((sum, r) => sum + (r.net || 0), 0);
}

/**
 * Average intake velocity in lbs/week, from sheet-to-sheet net total deltas.
 * Uses up to the last 4 deltas (5 sheets) so a single unusual week doesn't
 * swing the projection, while still reflecting a recent slowdown/pickup.
 * Returns null if fewer than 2 sheets exist (nothing to compare yet).
 */
export function computeIntakeVelocityLbsPerWeek(sheetsOldestFirst: MaterialInventorySheet[]): number | null {
  if (sheetsOldestFirst.length < 2) return null;

  const recent = sheetsOldestFirst.slice(-5);
  const deltas: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const daysBetween = (new Date(curr.date).getTime() - new Date(prev.date).getTime()) / 86400000;
    if (daysBetween <= 0) continue;
    const lbsDelta = computeSheetNetTotal(curr) - computeSheetNetTotal(prev);
    deltas.push((lbsDelta / daysBetween) * 7);
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
}

export interface TargetProjection {
  reached: boolean;
  /** ISO date string, or null if velocity is flat/negative and target isn't reached yet. */
  projectedDate: string | null;
  weeksRemaining: number | null;
}

/** Linear projection of when currentTotal reaches targetLbs at the given weekly velocity. */
export function projectDateToTarget(
  currentTotal: number,
  targetLbs: number,
  velocityLbsPerWeek: number | null,
  fromDate: Date = new Date()
): TargetProjection {
  if (currentTotal >= targetLbs) {
    return { reached: true, projectedDate: null, weeksRemaining: 0 };
  }
  if (!velocityLbsPerWeek || velocityLbsPerWeek <= 0) {
    return { reached: false, projectedDate: null, weeksRemaining: null };
  }
  const lbsNeeded = targetLbs - currentTotal;
  const weeksRemaining = lbsNeeded / velocityLbsPerWeek;
  const projected = new Date(fromDate.getTime() + weeksRemaining * 7 * 86400000);
  return { reached: false, projectedDate: projected.toISOString().split('T')[0], weeksRemaining };
}

export interface FulfillmentCountdown {
  deadline: string;
  daysRemaining: number;
  overdue: boolean;
}

/** 30-day fulfillment countdown once an order is locked with the buyer. */
export function computeFulfillmentCountdown(orderLockedAt: string | undefined | null, now: Date = new Date()): FulfillmentCountdown | null {
  if (!orderLockedAt) return null;
  const lockedDate = new Date(orderLockedAt);
  const deadlineDate = new Date(lockedDate.getTime() + FULFILLMENT_WINDOW_DAYS * 86400000);
  const daysRemaining = Math.ceil((deadlineDate.getTime() - now.getTime()) / 86400000);
  return {
    deadline: deadlineDate.toISOString().split('T')[0],
    daysRemaining,
    overdue: daysRemaining < 0
  };
}
