// ═══════════════════════════════════════════════════════════════════
// CASH LOGIC LOCK — money math contract. DO NOT MODIFY these formulas,
// field names, or the meaning of any status without an explicit,
// itemized instruction naming this file. Historical financial records
// depend on these being stable.
// ═══════════════════════════════════════════════════════════════════

export interface DenominationBreakdown {
  hundreds?: number;
  fifties?: number;
  twenties?: number;
  tens?: number;
  fives?: number;
  ones?: number;
  dollarCoins?: number;
  halfDollars?: number;
  quarters?: number;
  dimes?: number;
  nickels?: number;
}

export const DENOMINATION_FACE_VALUES: Record<keyof DenominationBreakdown, number> = {
  hundreds: 100,
  fifties: 50,
  twenties: 20,
  tens: 10,
  fives: 5,
  ones: 1,
  dollarCoins: 1,
  halfDollars: 0.5,
  quarters: 0.25,
  dimes: 0.1,
  nickels: 0.05
};

/**
 * Standard financial rounding contract: All money amounts MUST round to 2 decimal places.
 * Exactly mirrors CashDrawer.tsx: Math.round(val * 100) / 100
 */
export const roundMoney = (val: number): number => {
  return Math.round(val * 100) / 100;
};

/**
 * Contractual Definition of Session Statuses:
 * - 'open': Active, uncounted or in-progress session.
 * - 'closed': Counted & finalized reconciliation session.
 * - 'provisional': Missed physical count; carries assumed expected cash forward until finalized.
 */
export const SESSION_STATUS_CONTRACT = {
  OPEN: 'open' as const,
  CLOSED: 'closed' as const,
  PROVISIONAL: 'provisional' as const
};

/**
 * Single Field of Record:
 * `closingDenominations` on the `cashSessions` document is the single,
 * canonical field of record for the end-of-day physical cash count.
 */
export const PHYSICAL_COUNT_FIELD_OF_RECORD = 'closingDenominations' as const;

/**
 * Audit Log Immutability Contract:
 * Existing audit events are APPEND-ONLY.
 * Historical audit log entries in `auditLogs` must NEVER be edited or deleted.
 */
export const AUDIT_LOG_POLICY = 'APPEND_ONLY' as const;

/**
 * Formula: Calculate physical total from denomination counts.
 * actualCash = calculateDenomTotal(physical count denominations)
 */
export const calculateDenomTotal = (denoms?: DenominationBreakdown | null): number => {
  if (!denoms) return 0;
  const sum = (
    (Number(denoms.hundreds) || 0) +
    (Number(denoms.fifties) || 0) +
    (Number(denoms.twenties) || 0) +
    (Number(denoms.tens) || 0) +
    (Number(denoms.fives) || 0) +
    (Number(denoms.ones) || 0) +
    (Number(denoms.dollarCoins) || 0) +
    (Number(denoms.halfDollars) || 0) +
    (Number(denoms.quarters) || 0) +
    (Number(denoms.dimes) || 0) +
    (Number(denoms.nickels) || 0)
  );
  return roundMoney(sum);
};

/**
 * Formula: Calculate expected cash at any point during or after a session.
 * expectedCash = openingCash + totalReplenishments - totalPayouts - totalExpenses
 */
export const calculateExpectedCash = (
  openingCash: number,
  totalReplenishments: number,
  totalPayouts: number,
  totalExpenses: number
): number => {
  return roundMoney(openingCash + totalReplenishments - totalPayouts - totalExpenses);
};

/**
 * Formula: Calculate discrepancy between physical cash and expected cash.
 * overShort = actualCash - expectedCash
 * (Positive = Over, Negative = Short, 0 = Balanced)
 */
export const calculateOverShort = (actualCash: number, expectedCash: number): number => {
  return roundMoney(actualCash - expectedCash);
};

export interface CashLogicSelfTestSession {
  openingCash: number;
  expectedCash: number;
  actualCash?: number;
  overShort?: number;
  closingDenominations?: DenominationBreakdown | null;
  status?: 'open' | 'closed' | 'provisional';
}

export interface CashLogicSelfTestComponents {
  totalReplenishments?: number;
  totalPayouts?: number;
  totalExpenses?: number;
}

/**
 * Self-test function to verify session integrity against the cash logic contract.
 * Checks:
 *   - expectedCash equals formula (recompute and compare when components are provided)
 *   - overShort equals actualCash - expectedCash
 *   - actualCash matches calculateDenomTotal(closingDenominations) if both are present
 *   - No negative cash where forbidden (openingCash < 0, actualCash < 0, negative denoms)
 *   - No NaN money values slip through
 *
 * @returns A list of violations (empty array = pass).
 */
export function runCashLogicSelfTest(
  session: CashLogicSelfTestSession,
  components?: CashLogicSelfTestComponents
): string[] {
  const violations: string[] = [];

  // 1. Check for NaN or invalid money values
  if (typeof session.openingCash !== 'number' || isNaN(session.openingCash)) {
    violations.push(`Invalid openingCash: ${session.openingCash} is not a valid number`);
  } else if (session.openingCash < 0) {
    violations.push(`Negative openingCash: $${session.openingCash} is less than 0`);
  }

  if (typeof session.expectedCash !== 'number' || isNaN(session.expectedCash)) {
    violations.push(`Invalid expectedCash: ${session.expectedCash} is not a valid number`);
  }

  if (session.actualCash !== undefined) {
    if (typeof session.actualCash !== 'number' || isNaN(session.actualCash)) {
      violations.push(`Invalid actualCash: ${session.actualCash} is not a valid number`);
    } else if (session.actualCash < 0) {
      violations.push(`Negative actualCash: $${session.actualCash} is less than 0`);
    }
  }

  if (session.overShort !== undefined) {
    if (typeof session.overShort !== 'number' || isNaN(session.overShort)) {
      violations.push(`Invalid overShort: ${session.overShort} is not a valid number`);
    }
  }

  // 2. Validate denominations if present
  if (session.closingDenominations) {
    for (const [denomKey, val] of Object.entries(session.closingDenominations)) {
      if (val !== undefined && val !== null) {
        if (typeof val !== 'number' || isNaN(val)) {
          violations.push(`Invalid denomination value for ${denomKey}: ${val} is not a number`);
        } else if (val < 0) {
          violations.push(`Negative denomination value for ${denomKey}: ${val} is less than 0`);
        }
      }
    }

    if (session.actualCash !== undefined && !isNaN(session.actualCash)) {
      const computedDenomTotal = calculateDenomTotal(session.closingDenominations);
      if (Math.abs(computedDenomTotal - session.actualCash) > 0.01) {
        violations.push(
          `Actual cash mismatch: actualCash is $${session.actualCash}, but calculateDenomTotal(closingDenominations) is $${computedDenomTotal}`
        );
      }
    }
  }

  // 3. Validate expectedCash formula when components are provided
  if (components) {
    const replenishments = components.totalReplenishments ?? 0;
    const payouts = components.totalPayouts ?? 0;
    const expenses = components.totalExpenses ?? 0;

    if (isNaN(replenishments) || isNaN(payouts) || isNaN(expenses)) {
      violations.push('Transaction components contain NaN values');
    } else {
      const recomputedExpected = calculateExpectedCash(
        session.openingCash,
        replenishments,
        payouts,
        expenses
      );
      if (Math.abs(recomputedExpected - session.expectedCash) > 0.01) {
        violations.push(
          `expectedCash formula violation: expectedCash is $${session.expectedCash}, but formula yields $${recomputedExpected} (opening: $${session.openingCash} + replenishments: $${replenishments} - payouts: $${payouts} - expenses: $${expenses})`
        );
      }
    }
  }

  // 4. Validate overShort formula when actualCash and overShort are both present
  if (session.actualCash !== undefined && session.overShort !== undefined && !isNaN(session.actualCash) && !isNaN(session.overShort) && !isNaN(session.expectedCash)) {
    const recomputedOverShort = calculateOverShort(session.actualCash, session.expectedCash);
    if (Math.abs(recomputedOverShort - session.overShort) > 0.01) {
      violations.push(
        `overShort formula violation: overShort is $${session.overShort}, but actualCash ($${session.actualCash}) - expectedCash ($${session.expectedCash}) = $${recomputedOverShort}`
      );
    }
  }

  return violations;
}
