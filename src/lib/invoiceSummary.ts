import { TripTicketMaterial } from '../types';

/**
 * One printed row of an invoice: every box of the same material at the same
 * price, added together. Display only -- the invoice keeps its per-box lines.
 */
export interface InvoiceSummaryRow {
  materialId: string;
  customName?: string;
  salePrice: number;
  boxCount: number;
  /** Net (material) weight: the sum of the lines' `weight`. */
  netWeight: number;
  /** Null unless EVERY box in the row has a gross, so a partial figure is never printed as the total. */
  grossWeight: number | null;
  tareWeight: number | null;
  /** Sum of each box's weight x price -- the same terms the invoice total is built from. */
  amount: number;
}

/**
 * Groups invoice lines by material + custom name + unit price, in order of first
 * appearance. Price is part of the key on purpose: the same material sold at two
 * prices stays as two rows, each with one true unit price.
 */
const groupKey = (line: TripTicketMaterial) =>
  JSON.stringify([line.materialId, line.customName || '', line.salePrice]);

export function consolidateInvoiceLines(lines: TripTicketMaterial[]): InvoiceSummaryRow[] {
  const rows = new Map<string, InvoiceSummaryRow & { grossComplete: boolean }>();
  for (const line of lines) {
    const key = groupKey(line);
    const hasGross = line.grossWeight !== undefined && line.grossWeight > 0;
    let row = rows.get(key);
    if (!row) {
      row = {
        materialId: line.materialId,
        customName: line.customName || undefined,
        salePrice: line.salePrice,
        boxCount: 0,
        netWeight: 0,
        grossWeight: 0,
        tareWeight: 0,
        amount: 0,
        grossComplete: true,
      };
      rows.set(key, row);
    }
    row.boxCount += 1;
    row.netWeight += line.weight;
    row.amount += line.weight * line.salePrice;
    if (hasGross) {
      row.grossWeight = (row.grossWeight || 0) + (line.grossWeight || 0);
      row.tareWeight = (row.tareWeight || 0) + (line.tareWeight || 0);
    } else {
      row.grossComplete = false;
    }
  }
  return Array.from(rows.values()).map(({ grossComplete, ...row }) => ({
    ...row,
    grossWeight: grossComplete ? row.grossWeight : null,
    tareWeight: grossComplete ? row.tareWeight : null,
  }));
}

/** One material group of the grouped (Detailed) invoice: its subtotal row plus its boxes, in invoice order. */
export interface InvoiceLineGroup {
  summary: InvoiceSummaryRow;
  lines: TripTicketMaterial[];
}

/**
 * The same groups as consolidateInvoiceLines, each with the boxes that make it up,
 * sorted A-Z by printed name (then by price), like the owner's Google Sheet.
 * Display only -- the invoice keeps its per-box lines.
 */
export function groupInvoiceLines(
  lines: TripTicketMaterial[],
  nameOf: (line: { materialId: string; customName?: string }) => string
): InvoiceLineGroup[] {
  const linesByKey = new Map<string, TripTicketMaterial[]>();
  for (const line of lines) {
    const key = groupKey(line);
    linesByKey.set(key, [...(linesByKey.get(key) || []), line]);
  }
  return consolidateInvoiceLines(lines)
    .map(summary => ({
      summary,
      lines: linesByKey.get(JSON.stringify([summary.materialId, summary.customName || '', summary.salePrice])) || [],
    }))
    .sort((a, b) =>
      nameOf(a.summary).localeCompare(nameOf(b.summary), undefined, { sensitivity: 'base', numeric: true }) ||
      a.summary.salePrice - b.summary.salePrice
    );
}
