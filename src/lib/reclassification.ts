import { BuyTicket, MaterialReclassification } from '../types';

/**
 * Reclassifications re-label a completed ticket's lines as another material WITHOUT
 * changing the ticket (it stays what the seller signed and what was reported to Ohio).
 * These helpers give the two views the rest of the app needs:
 *
 *  - per ticket: which material each line counts as now (Ticket History display,
 *    search, and the inventory reversal on void/delete);
 *  - per material over time: the book weight moved in/out by reclassifications, dated
 *    when the reclassification was recorded (inventory variance "since" a baseline).
 *
 * Pure functions, no Firestore.
 */

const byTimestamp = (a: MaterialReclassification, b: MaterialReclassification) =>
  (a.timestamp || '').localeCompare(b.timestamp || '');

/** Reclassifications grouped by ticket id, each list oldest first. */
export function groupReclassificationsByTicket(
  reclassifications: MaterialReclassification[]
): Map<string, MaterialReclassification[]> {
  const map = new Map<string, MaterialReclassification[]>();
  [...reclassifications].sort(byTimestamp).forEach(r => {
    map.set(r.ticketId, [...(map.get(r.ticketId) || []), r]);
  });
  return map;
}

/** The material each line of the ticket counts as now (applies reclassifications in order). */
export function effectiveLineMaterialIds(
  ticket: BuyTicket,
  ticketReclassifications: MaterialReclassification[] = []
): string[] {
  const ids = (ticket.materials || []).map(line => line.materialId);
  [...ticketReclassifications].sort(byTimestamp).forEach(r => {
    r.lineIndexes.forEach(i => {
      if (i >= 0 && i < ids.length) ids[i] = r.toMaterialId;
    });
  });
  return ids;
}

/** The ticket with each line's materialId replaced by the material it counts as now. */
export function withEffectiveMaterials(
  ticket: BuyTicket,
  ticketReclassifications: MaterialReclassification[] = []
): BuyTicket {
  if (ticketReclassifications.length === 0) return ticket;
  const ids = effectiveLineMaterialIds(ticket, ticketReclassifications);
  return { ...ticket, materials: (ticket.materials || []).map((line, i) => ({ ...line, materialId: ids[i] })) };
}

/**
 * Net book weight moved INTO `materialId` by reclassifications recorded after
 * `sinceTimestamp` (all of them when omitted). Positive = moved in, negative = moved out.
 * Only reclassifications of tickets in `countedTicketIds` count, so a reclassification
 * of a voided or deleted ticket (whose weight was already taken back out) is ignored.
 */
export function reclassificationNetChange(
  reclassifications: MaterialReclassification[],
  materialId: string,
  countedTicketIds: Set<string>,
  sinceTimestamp?: string
): number {
  return reclassifications.reduce((sum, r) => {
    if (!countedTicketIds.has(r.ticketId)) return sum;
    if (sinceTimestamp && !((r.timestamp || '') > sinceTimestamp)) return sum;
    if (r.toMaterialId === materialId) sum += r.weight;
    if (r.fromMaterialId === materialId) sum -= r.weight;
    return sum;
  }, 0);
}
