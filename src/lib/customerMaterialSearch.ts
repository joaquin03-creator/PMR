import { BuyTicket, Customer } from '../types';

export type QuantityMode = 'single' | 'cumulative';
export type VisitFilter = 'any' | 'first-time' | 'repeat';
export type RecencyFilter = 'any' | '30' | '60' | '90';
export type CustomerTypeFilter = 'any' | 'individual' | 'commercial' | 'industrial';

export interface CustomerSearchCriteria {
  /** Resolved set of material ids to match -- a single id for an exact material, or every id in a category. */
  materialIds: string[];
  minWeightLbs: number;
  quantityMode: QuantityMode;
  dateFrom?: string; // 'YYYY-MM-DD', inclusive
  dateTo?: string; // 'YYYY-MM-DD', inclusive
  visitFilter: VisitFilter;
  recencyFilter: RecencyFilter;
  customerTypeFilter: CustomerTypeFilter;
}

export interface MatchedTicketRef {
  ticketId: string;
  timestamp: string;
  weightLbs: number;
}

export interface CustomerSearchResult {
  customerId: string;
  customer: Customer;
  /** Single mode: the qualifying ticket's weight (max, if more than one qualifies). Cumulative mode: the sum. */
  matchedWeightLbs: number;
  matchedTickets: MatchedTicketRef[];
  /** All-time completed ticket count, not limited by material or date range. */
  totalVisits: number;
  lastVisitTimestamp: string;
  daysSinceLastVisit: number;
}

const lineItemWeightLbs = (unit: 'lb' | 'ton' | undefined, netWeight: number): number =>
  unit === 'ton' ? netWeight * 2000 : netWeight;

const isWithinDateRange = (timestamp: string, dateFrom?: string, dateTo?: string): boolean => {
  if (!timestamp) return false;
  const ticketDate = new Date(timestamp).toLocaleDateString('en-CA');
  if (dateFrom && ticketDate < dateFrom) return false;
  if (dateTo && ticketDate > dateTo) return false;
  return true;
};

export function searchCustomersByMaterial(
  buyTickets: BuyTicket[],
  customers: Customer[],
  criteria: CustomerSearchCriteria,
  now: number = Date.now()
): CustomerSearchResult[] {
  const completedTickets = buyTickets.filter(t => t.status === 'completed');

  // All-time per-customer aggregates -- deliberately NOT limited by the material
  // filter or date range, since "how many times have they visited us, ever" and
  // "how long since we last saw them" describe the customer overall.
  const overall = new Map<string, { count: number; lastVisit: string }>();
  completedTickets.forEach(t => {
    if (!t.customerId || !t.timestamp) return;
    const existing = overall.get(t.customerId);
    if (!existing) {
      overall.set(t.customerId, { count: 1, lastVisit: t.timestamp });
    } else {
      existing.count += 1;
      if (t.timestamp > existing.lastVisit) existing.lastVisit = t.timestamp;
    }
  });

  const materialIdSet = new Set(criteria.materialIds);

  const ticketMatches: { ticket: BuyTicket; weightLbs: number }[] = [];
  completedTickets.forEach(t => {
    if (!isWithinDateRange(t.timestamp, criteria.dateFrom, criteria.dateTo)) return;
    const weightLbs = (t.materials || [])
      .filter(m => materialIdSet.has(m.materialId))
      .reduce((sum, m) => sum + lineItemWeightLbs(m.unit, m.netWeight), 0);
    if (weightLbs > 0) ticketMatches.push({ ticket: t, weightLbs });
  });

  const resultsByCustomer = new Map<string, CustomerSearchResult>();

  const buildResult = (customerId: string, weightLbs: number, tickets: MatchedTicketRef[]): CustomerSearchResult | null => {
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return null;
    const agg = overall.get(customerId);
    const lastVisitTimestamp = agg?.lastVisit ?? tickets[0].timestamp;
    return {
      customerId,
      customer,
      matchedWeightLbs: weightLbs,
      matchedTickets: tickets,
      totalVisits: agg?.count ?? tickets.length,
      lastVisitTimestamp,
      daysSinceLastVisit: Math.floor((now - new Date(lastVisitTimestamp).getTime()) / 86400000),
    };
  };

  if (criteria.quantityMode === 'single') {
    ticketMatches
      .filter(tm => tm.weightLbs >= criteria.minWeightLbs)
      .forEach(tm => {
        const customerId = tm.ticket.customerId;
        const entry: MatchedTicketRef = { ticketId: tm.ticket.id, timestamp: tm.ticket.timestamp, weightLbs: tm.weightLbs };
        const existing = resultsByCustomer.get(customerId);
        if (existing) {
          existing.matchedTickets.push(entry);
          existing.matchedWeightLbs = Math.max(existing.matchedWeightLbs, tm.weightLbs);
        } else {
          const result = buildResult(customerId, tm.weightLbs, [entry]);
          if (result) resultsByCustomer.set(customerId, result);
        }
      });
  } else {
    const cumulative = new Map<string, MatchedTicketRef[]>();
    ticketMatches.forEach(tm => {
      const customerId = tm.ticket.customerId;
      const entry: MatchedTicketRef = { ticketId: tm.ticket.id, timestamp: tm.ticket.timestamp, weightLbs: tm.weightLbs };
      const existing = cumulative.get(customerId);
      if (existing) existing.push(entry);
      else cumulative.set(customerId, [entry]);
    });
    cumulative.forEach((tickets, customerId) => {
      const total = tickets.reduce((sum, t) => sum + t.weightLbs, 0);
      if (total < criteria.minWeightLbs) return;
      const result = buildResult(customerId, total, tickets);
      if (result) resultsByCustomer.set(customerId, result);
    });
  }

  let results = Array.from(resultsByCustomer.values());

  if (criteria.visitFilter === 'first-time') {
    results = results.filter(r => r.totalVisits === 1);
  } else if (criteria.visitFilter === 'repeat') {
    results = results.filter(r => r.totalVisits >= 2);
  }

  if (criteria.recencyFilter !== 'any') {
    const minDays = parseInt(criteria.recencyFilter, 10);
    results = results.filter(r => r.daysSinceLastVisit >= minDays);
  }

  if (criteria.customerTypeFilter !== 'any') {
    results = results.filter(r => (r.customer.customerType || 'individual') === criteria.customerTypeFilter);
  }

  results.sort((a, b) => b.matchedWeightLbs - a.matchedWeightLbs);

  return results;
}
