// ═══════════════════════════════════════════════════════════════════
// OHIO XML SCHEMA LOCK — Ohio ORC 4737 compliance report format contract.
// This format took five live portal rejection cycles to crack. DO NOT
// "fix" the required Ohio spelling typos or change these formats
// without an explicit, itemized instruction naming this file.
// See AGENTS.md §1b for the full history.
// ═══════════════════════════════════════════════════════════════════

import type { BuyTicket, Customer } from '../types';

/**
 * Ohio's schema requires these exact (misspelled) tag names. Never
 * "correct" them — the state's portal rejects the properly-spelled
 * versions.
 */
export const REQUIRED_TYPO_TAGS = [
  'bulkContainerPhoptos',
  'licensePlateNumner',
  'recycMaterilasNotSpecialPurchaseArticles'
] as const;

/**
 * weightOfBulkContainers and recycMaterilasNotSpecialPurchaseArticles
 * are both "index-weight" / "code-weight" PAIR lists (e.g. "1-10,2-20"),
 * never a bare total or bare code list.
 */
export const PAIR_FORMAT_REGEX = /^\d+-\d{1,5}(,\d+-\d{1,5})*$/;

/**
 * txnDateTime must be 12-hour local time as "MM/DD/YYYY hh:mm:ss AM/PM",
 * never ISO 8601.
 */
export const TXN_DATETIME_REGEX = /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} (AM|PM)$/;

/**
 * Photo count / declared container count are capped at 5 per transaction.
 */
export const MAX_CONTAINERS = 5;

/**
 * These two tags must always be present but EMPTY in PMR's filings
 * (PMR does not buy non-recyclable metal articles under this category).
 */
export const REQUIRED_EMPTY_TAGS = [
  'metalArticlesNotRecyclableDesc',
  'weightOfMetalArticlesNotRecyclable'
] as const;

/**
 * Placeholder address the generator falls back to when a customer has
 * no address on file (src/pages/Reports.tsx handleGenerateXml). Kept
 * here so the per-ticket readiness check can warn before this fake
 * address ends up in a real state filing.
 */
export const PLACEHOLDER_ADDRESS_MARKERS = ['123 Main St', 'Columbus, OH 43215'] as const;

/**
 * Self-test against the generated Ohio XML string. This is narrower than
 * Reports.tsx's validateXmlContent (which checks Ohio's broad error codes
 * 104-129) — it exists specifically to catch a REGRESSION in
 * handleGenerateXml (e.g. someone "fixing" a required typo or changing a
 * date format), not to replace that validator.
 *
 * @returns A list of violations (empty array = pass).
 */
export function runOhioXmlSelfTest(xml: string, expectedTxnCount: number): string[] {
  const violations: string[] = [];

  if (!xml || xml.trim() === '') {
    violations.push('Generated XML is empty.');
    return violations;
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
    const parserError = doc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      violations.push(`XML failed to parse: ${parserError.textContent}`);
      return violations;
    }
  } catch (e: any) {
    violations.push(`XML parser threw an exception: ${e?.message || e}`);
    return violations;
  }

  const transactions = doc.getElementsByTagName('ScrapDealerTransaction');

  if (transactions.length !== expectedTxnCount) {
    violations.push(
      `Transaction count mismatch: file contains ${transactions.length} <ScrapDealerTransaction> block(s), expected ${expectedTxnCount}.`
    );
  }

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const label = `Transaction #${i + 1}`;
    const getVal = (tag: string) => tx.getElementsByTagName(tag)[0]?.textContent ?? null;

    // Required typo tags must exist (not "corrected" to proper spelling).
    for (const tag of REQUIRED_TYPO_TAGS) {
      if (tx.getElementsByTagName(tag).length === 0) {
        violations.push(
          `${label}: required tag <${tag}> is missing. This is a required Ohio spelling — do not rename it.`
        );
      }
    }

    // Pair-format fields.
    const weightPairs = getVal('weightOfBulkContainers');
    if (weightPairs !== null && weightPairs !== '' && !PAIR_FORMAT_REGEX.test(weightPairs)) {
      violations.push(
        `${label}: weightOfBulkContainers "${weightPairs}" is not in "index-weight" pair format (e.g. "1-10,2-20").`
      );
    }

    const recycPairs = getVal('recycMaterilasNotSpecialPurchaseArticles');
    if (recycPairs !== null && recycPairs !== '' && !PAIR_FORMAT_REGEX.test(recycPairs)) {
      violations.push(
        `${label}: recycMaterilasNotSpecialPurchaseArticles "${recycPairs}" is not in "code-weight" pair format (e.g. "11-10,14-20").`
      );
    }

    // numberOfBulkContainers must be populated (empty tag = Ohio error 118),
    // and its declared count must match the photo count, capped at MAX_CONTAINERS.
    const containerCountRaw = getVal('numberOfBulkContainers');
    if (!containerCountRaw || containerCountRaw.trim() === '') {
      violations.push(`${label}: numberOfBulkContainers is empty (Ohio error 118).`);
    } else {
      const declaredCount = parseInt(containerCountRaw, 10);
      const photosContainer = tx.getElementsByTagName('bulkContainerPhoptos')[0];
      const photoCount = photosContainer ? photosContainer.getElementsByTagName('base64Binary').length : 0;
      if (isNaN(declaredCount)) {
        violations.push(`${label}: numberOfBulkContainers "${containerCountRaw}" is not a number.`);
      } else {
        if (declaredCount > MAX_CONTAINERS) {
          violations.push(`${label}: numberOfBulkContainers is ${declaredCount}, exceeds the ${MAX_CONTAINERS}-container cap.`);
        }
        if (declaredCount !== photoCount) {
          violations.push(
            `${label}: numberOfBulkContainers (${declaredCount}) does not match photo count in bulkContainerPhoptos (${photoCount}).`
          );
        }
      }
    }

    // txnDateTime must be 12-hour local format, never ISO.
    const txnDateTime = getVal('txnDateTime');
    if (!txnDateTime || txnDateTime.trim() === '') {
      violations.push(`${label}: txnDateTime is missing.`);
    } else if (!TXN_DATETIME_REGEX.test(txnDateTime)) {
      violations.push(
        `${label}: txnDateTime "${txnDateTime}" is not in "MM/DD/YYYY hh:mm:ss AM/PM" format (looks like ISO or another format was substituted).`
      );
    }

    // Required-empty tags must actually be empty.
    for (const tag of REQUIRED_EMPTY_TAGS) {
      const val = getVal(tag);
      if (val !== null && val.trim() !== '') {
        violations.push(`${label}: <${tag}> must be empty but contains "${val}".`);
      }
    }
  }

  return violations;
}

/**
 * Soft, informational, non-blocking check on a single ticket's raw fields
 * that feed the Ohio XML derivation in handleGenerateXml. Returns warning
 * strings describing data that will silently degrade or be fabricated in
 * the state filing — never called anywhere that can block ticket
 * completion.
 *
 * @returns A list of warnings (empty array = clean).
 */
export function checkTicketOhioReadiness(ticket: BuyTicket, customer?: Customer): string[] {
  const warnings: string[] = [];

  const plate = (ticket.vehiclePlate || '').trim();
  if (plate.length > 20) {
    warnings.push(
      `Vehicle plate "${plate}" is ${plate.length} characters — will be silently truncated to 20 in the Ohio filing.`
    );
  }

  const address = (customer?.address || '').trim();
  if (!address) {
    warnings.push(
      'Customer has no address on file — the Ohio filing will substitute a placeholder Columbus address instead of the real one.'
    );
  }

  const name = (customer?.name || '').trim();
  if (!name) {
    warnings.push('Customer has no name on file — the Ohio filing will default first/last name to "Unknown".');
  }

  if (!ticket.materials || ticket.materials.length === 0) {
    warnings.push('Ticket has no material line items — nothing to report for this transaction.');
  }

  return warnings;
}
