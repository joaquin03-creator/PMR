// ═══════════════════════════════════════════════════════════════════
// PROVISIONAL CASH — status-keyed READ helpers for cash sessions.
//
// This file contains NO money math. The locked formulas live in
// cashLogicLock.ts and are not touched here. These helpers only decide
// WHICH stored figure a screen/export should read for a session:
//
//   - A physically counted session ('closed', or 'open' with a count)
//     -> `actualCash` (= calculateDenomTotal(closingDenominations)).
//   - A 'provisional' session (closed with NO physical count)
//     -> `provisionalAssumedCash` (the expected cash it was closed on).
//
// A provisional session's assumed figure is never a physical count and
// must never be shown or carried as one; its over/short is PENDING until
// the session is finalized with a real count.
//
// Keyed off `status` (not off which fields are present) on purpose:
// provisional sessions closed before this helper existed still have
// actualCash = assumed and overShort = 0 stored on them. Reading through
// here makes those display correctly with no data rewrite.
// ═══════════════════════════════════════════════════════════════════

export interface ProvisionalAwareSession {
  status?: 'open' | 'closed' | 'provisional';
  expectedCash?: number;
  actualCash?: number | null;
  overShort?: number | null;
  provisionalAssumedCash?: number | null;
}

/** True when the session was closed on an assumed balance with no physical count. */
export const isProvisionalSession = (session?: ProvisionalAwareSession | null): boolean => {
  return session?.status === 'provisional';
};

/**
 * The figure a session closed on, for carry-forward and display.
 * Provisional -> the assumed (expected) cash it was closed on.
 * Anything else -> the stored physical count, or undefined if none.
 */
export const getClosingBasis = (session?: ProvisionalAwareSession | null): number | undefined => {
  if (!session) return undefined;
  if (isProvisionalSession(session)) {
    return session.provisionalAssumedCash ?? session.expectedCash ?? undefined;
  }
  return session.actualCash ?? undefined;
};

/**
 * The stored over/short, or undefined when it is not a real variance.
 * A provisional session has no physical count, so its over/short is
 * always PENDING (undefined) regardless of what is stored on the record.
 */
export const getCountedOverShort = (session?: ProvisionalAwareSession | null): number | undefined => {
  if (!session || isProvisionalSession(session)) return undefined;
  return session.overShort ?? undefined;
};
