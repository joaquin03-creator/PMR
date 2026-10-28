import { auth } from '../firebase';
import firebaseConfig from '../../firebase-applet-config.json';
import { getEasternDateParts } from './utils';

/**
 * Day-of-week report (Reports → Days of Week).
 *
 * Tickets embed their photos (~190 KB each), so loading months of them through the normal
 * listeners would pull hundreds of MB. This report only needs a handful of fields, so it asks
 * Firestore's REST API for just those (a field mask), signed in as the current user: the same
 * security rules apply as for any other read. ~5 KB per ticket instead of ~190 KB.
 */

export interface LiteTicketLine {
  materialId: string;
  netWeight: number;
  totalAmount: number;
}

export interface LiteTicket {
  id: string;
  timestamp: string;
  totalAmount: number;
  status: string;
  customerId: string;
  materials: LiteTicketLine[];
}

const LITE_FIELDS = ['timestamp', 'totalAmount', 'status', 'customerId', 'materials'];

function fromValue(v: any): any {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) {
    const out: Record<string, any> = {};
    for (const [k, inner] of Object.entries(v.mapValue.fields || {})) out[k] = fromValue(inner);
    return out;
  }
  return undefined;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** Every buy ticket with a timestamp in [startIso, endIso], light fields only. */
export async function fetchLiteTickets(startIso: string, endIso: string, signal?: AbortSignal): Promise<LiteTicket[]> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const token = await user.getIdToken();
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'buyTickets' }],
      select: { fields: LITE_FIELDS.map(fieldPath => ({ fieldPath })) },
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'timestamp' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: startIso } } },
            { fieldFilter: { field: { fieldPath: 'timestamp' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: endIso } } }
          ]
        }
      }
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw new Error(`Ticket download failed (${res.status}).`);
  const rows: any[] = await res.json();
  return rows
    .filter(r => r && r.document)
    .map(r => {
      const f: Record<string, any> = {};
      for (const [k, v] of Object.entries(r.document.fields || {})) f[k] = fromValue(v);
      const lines: any[] = Array.isArray(f.materials) ? f.materials : [];
      return {
        id: String(r.document.name).split('/').pop() as string,
        timestamp: String(f.timestamp || ''),
        totalAmount: num(f.totalAmount),
        status: String(f.status || 'completed'),
        customerId: String(f.customerId || ''),
        materials: lines.map(l => ({
          materialId: String(l?.materialId || ''),
          netWeight: num(l?.netWeight),
          totalAmount: num(l?.totalAmount)
        }))
      };
    });
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Display order: Monday first. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The yard's calendar day (US Eastern) for a ticket timestamp, as YYYY-MM-DD. */
export function easternDateKey(timestamp: string): string {
  const { year, month, day } = getEasternDateParts(new Date(timestamp));
  return `${year}-${month}-${day}`;
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface DayRow {
  date: string; // YYYY-MM-DD (Eastern)
  weekday: number;
  tickets: number;
  customers: number;
  payout: number;
  weight: number;
  estRevenue: number;
  estProfit: number;
}

/**
 * One row per calendar day that has at least one completed ticket.
 * Payout = the tickets' totals (what was paid). Est. revenue/profit use the same sell price
 * lookup as the rest of Reports, passed in as `salePriceFor`; profit = est. revenue − line totals,
 * as in the Materials tab.
 */
export function buildDayRows(tickets: LiteTicket[], salePriceFor: (materialId: string, timestamp: string) => number): DayRow[] {
  const byDay = new Map<string, DayRow & { customerIds: Set<string> }>();
  for (const t of tickets) {
    if ((t.status || 'completed') !== 'completed' || !t.timestamp) continue;
    const date = easternDateKey(t.timestamp);
    let row = byDay.get(date);
    if (!row) {
      row = { date, weekday: weekdayOf(date), tickets: 0, customers: 0, payout: 0, weight: 0, estRevenue: 0, estProfit: 0, customerIds: new Set() };
      byDay.set(date, row);
    }
    row.tickets += 1;
    row.payout += t.totalAmount;
    if (t.customerId) row.customerIds.add(t.customerId);
    for (const l of t.materials) {
      const revenue = salePriceFor(l.materialId, t.timestamp) * l.netWeight;
      row.weight += l.netWeight;
      row.estRevenue += revenue;
      row.estProfit += revenue - l.totalAmount;
    }
  }
  return [...byDay.values()]
    .map(({ customerIds, ...r }) => ({ ...r, customers: customerIds.size }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface WeekdaySummary {
  weekday: number;
  daysOpen: number; // days of this weekday with at least one completed ticket
  tickets: number;
  payout: number;
  weight: number;
  estProfit: number;
  avgPayout: number; // per day open
  medianPayout: number; // per day open; one huge load moves this far less than the average
  avgTickets: number;
  avgWeight: number;
  avgProfit: number;
  bestDay: DayRow | null;
  slowestDay: DayRow | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** One summary per weekday (all seven, Monday first), averaged over the days that had tickets. */
export function summarizeWeekdays(days: DayRow[]): WeekdaySummary[] {
  return WEEKDAY_ORDER.map(weekday => {
    const rows = days.filter(d => d.weekday === weekday);
    const n = rows.length;
    const sum = (f: (d: DayRow) => number) => rows.reduce((s, d) => s + f(d), 0);
    const payout = sum(d => d.payout);
    const byPayout = [...rows].sort((a, b) => b.payout - a.payout);
    return {
      weekday,
      daysOpen: n,
      tickets: sum(d => d.tickets),
      payout,
      weight: sum(d => d.weight),
      estProfit: sum(d => d.estProfit),
      avgPayout: n ? payout / n : 0,
      medianPayout: median(rows.map(d => d.payout)),
      avgTickets: n ? sum(d => d.tickets) / n : 0,
      avgWeight: n ? sum(d => d.weight) / n : 0,
      avgProfit: n ? sum(d => d.estProfit) / n : 0,
      bestDay: byPayout[0] || null,
      slowestDay: byPayout[n - 1] || null
    };
  });
}
