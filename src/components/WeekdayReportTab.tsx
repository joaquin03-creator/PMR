import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { CalendarDays, Download, RefreshCw, Trophy, Turtle } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  LiteTicket, fetchLiteTickets, buildDayRows, summarizeWeekdays,
  WEEKDAY_NAMES, WEEKDAY_SHORT, WEEKDAY_ORDER
} from '../lib/weekdayReport';

type RangeKey = 'all' | '4w' | '3m' | '6m' | 'custom';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: '4w', label: 'Last 4 Weeks' },
  { key: '3m', label: 'Last 3 Months' },
  { key: '6m', label: 'Last 6 Months' },
  { key: 'custom', label: 'Custom' }
];

const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (v: number) => `${Math.round(v) < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;
const lbs = (v: number) => `${Math.round(v).toLocaleString()} lb`;
const prettyDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

function rangeBounds(range: RangeKey, custom: { start: string; end: string }): { startIso: string; endIso: string } | null {
  const now = new Date();
  const start = new Date(now);
  if (range === 'all') return { startIso: '2000-01-01T00:00:00.000Z', endIso: now.toISOString() };
  if (range === '4w') start.setDate(start.getDate() - 28);
  else if (range === '3m') start.setMonth(start.getMonth() - 3);
  else if (range === '6m') start.setMonth(start.getMonth() - 6);
  else {
    if (!custom.start) return null;
    const s = new Date(`${custom.start}T00:00:00`);
    const e = custom.end ? new Date(`${custom.end}T23:59:59.999`) : now;
    return { startIso: s.toISOString(), endIso: e.toISOString() };
  }
  start.setHours(0, 0, 0, 0);
  return { startIso: start.toISOString(), endIso: now.toISOString() };
}

export interface WeekdayReportTabProps {
  /** Sell price for a material on a ticket's date: the same lookup the rest of Reports uses. */
  salePriceFor: (materialId: string, timestamp: string) => number;
}

/** Reports → Days of Week: how each weekday does, and every individual date for the days picked. */
export function WeekdayReportTab({ salePriceFor }: WeekdayReportTabProps) {
  const [range, setRange] = useState<RangeKey>('all');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [selected, setSelected] = useState<number[]>([]);
  const [tickets, setTickets] = useState<LiteTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const bounds = useMemo(() => rangeBounds(range, custom), [range, custom]);

  useEffect(() => {
    if (!bounds) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchLiteTickets(bounds.startIso, bounds.endIso, ctrl.signal)
      .then(setTickets)
      .catch(e => {
        if (ctrl.signal.aborted) return;
        console.warn('Days of Week report: ticket download failed', e);
        setError(navigator.onLine ? 'Could not load tickets. Try Refresh.' : 'Offline: this report needs a connection.');
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // reloadKey: the Refresh button
  }, [bounds?.startIso, bounds?.endIso, reloadKey]);

  const days = useMemo(() => buildDayRows(tickets, salePriceFor), [tickets, salePriceFor]);
  const summaries = useMemo(() => summarizeWeekdays(days), [days]);

  const ranked = summaries.filter(s => s.daysOpen > 0).sort((a, b) => b.avgPayout - a.avgPayout);
  const best = ranked[0]?.weekday;
  const slowest = ranked.length > 1 ? ranked[ranked.length - 1].weekday : undefined;

  const selectedDays = useMemo(
    () => days.filter(d => selected.includes(d.weekday)),
    [days, selected]
  );
  const selTotals = useMemo(() => {
    const t = selectedDays.reduce(
      (acc, d) => ({
        tickets: acc.tickets + d.tickets,
        payout: acc.payout + d.payout,
        weight: acc.weight + d.weight,
        estProfit: acc.estProfit + d.estProfit
      }),
      { tickets: 0, payout: 0, weight: 0, estProfit: 0 }
    );
    return { ...t, days: selectedDays.length };
  }, [selectedDays]);

  const toggle = (w: number) =>
    setSelected(prev => (prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w]));

  const chartData = summaries.map(s => ({
    weekday: s.weekday,
    name: WEEKDAY_SHORT[s.weekday],
    avgPayout: Math.round(s.avgPayout * 100) / 100,
    medianPayout: Math.round(s.medianPayout * 100) / 100
  }));

  const downloadCsv = () => {
    const rows = selected.length ? selectedDays : days;
    const header = ['Date', 'Day', 'Tickets', 'Customers', 'Payout ($)', 'Weight (lb)', 'Est. Revenue ($)', 'Est. Profit ($)'];
    const lines = rows.map(d => [
      d.date, WEEKDAY_NAMES[d.weekday], d.tickets, d.customers,
      d.payout.toFixed(2), d.weight.toFixed(2), d.estRevenue.toFixed(2), d.estProfit.toFixed(2)
    ].join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const which = selected.length ? WEEKDAY_ORDER.filter(w => selected.includes(w)).map(w => WEEKDAY_SHORT[w]).join('-') : 'all-days';
    a.download = `days_of_week_${which}_${range}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Range + weekday pickers */}
      <section className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4 print:hidden" aria-label="Days of week filters">
        <div className="flex flex-wrap items-center gap-3">
          <nav className="flex flex-wrap bg-slate-100 p-1 rounded-xl" aria-label="Date range">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  'px-4 py-2 text-sm font-bold rounded-lg transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  range === r.key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
                aria-current={range === r.key ? 'page' : undefined}
              >
                {r.label}
              </button>
            ))}
          </nav>
          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <label htmlFor="wd-start" className="sr-only">Start date</label>
              <input id="wd-start" type="date" value={custom.start}
                onChange={e => setCustom(p => ({ ...p, start: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="text-slate-400" aria-hidden="true">to</span>
              <label htmlFor="wd-end" className="sr-only">End date</label>
              <input id="wd-end" type="date" value={custom.end}
                onChange={e => setCustom(p => ({ ...p, end: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          <button
            onClick={() => setReloadKey(k => k + 1)}
            disabled={loading || !bounds}
            className="ml-auto flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} aria-hidden="true" />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1">Show dates for</span>
          {WEEKDAY_ORDER.map(w => (
            <button
              key={w}
              onClick={() => toggle(w)}
              aria-pressed={selected.includes(w)}
              className={cn(
                'px-3 py-1.5 text-sm font-bold rounded-full border transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                selected.includes(w) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'
              )}
            >
              {WEEKDAY_SHORT[w]}
            </button>
          ))}
          <button
            onClick={() => setSelected([6, 0])}
            className="px-3 py-1.5 text-xs font-bold text-blue-600 hover:underline"
          >
            Weekends
          </button>
          {selected.length > 0 && (
            <button onClick={() => setSelected([])} className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:underline">
              Clear
            </button>
          )}
        </div>
      </section>

      {error && (
        <p className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm font-bold text-red-700">{error}</p>
      )}
      {!bounds && (
        <p className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-500">Pick a start date.</p>
      )}

      {/* Weekday ranking */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:border-slate-300" aria-label="Weekday comparison">
        <div className="p-6 pb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 flex items-center gap-2 uppercase tracking-tight text-sm">
              <CalendarDays className="w-5 h-5 text-blue-600" aria-hidden="true" />
              Weekday Comparison
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Averages are per day that had tickets (days the yard was closed don't count). Completed tickets only. Click a row to list its dates.
            </p>
          </div>
          {ranked.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Trophy className="w-3.5 h-3.5" aria-hidden="true" /> Best: {WEEKDAY_NAMES[best!]}
              </span>
              {slowest !== undefined && (
                <span className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  <Turtle className="w-3.5 h-3.5" aria-hidden="true" /> Slowest: {WEEKDAY_NAMES[slowest]}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="h-[240px] w-full px-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b', fontWeight: 'bold' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} tickFormatter={v => `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k`} />
              <Tooltip
                cursor={{ fill: '#f8fafc' }}
                formatter={(v: number, name: string) => [money(v), name]}
                contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
              />
              <Bar dataKey="avgPayout" name="Avg payout per day" radius={[6, 6, 0, 0]} barSize={28} onClick={(d: any) => toggle(d.weekday)} className="cursor-pointer">
                {chartData.map(d => (
                  <Cell key={d.weekday} fill={selected.includes(d.weekday) ? '#2563eb' : '#93c5fd'} />
                ))}
              </Bar>
              <Bar dataKey="medianPayout" name="Typical (median) day" radius={[6, 6, 0, 0]} barSize={12} fill="#cbd5e1" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Day</th>
                <th className="px-4 py-3 text-right">Days w/ Tickets</th>
                <th className="px-4 py-3 text-right">Tickets</th>
                <th className="px-4 py-3 text-right">Avg Tickets / Day</th>
                <th className="px-4 py-3 text-right">Avg Payout / Day</th>
                <th className="px-4 py-3 text-right">Typical Day</th>
                <th className="px-4 py-3 text-right">Avg Weight / Day</th>
                <th className="px-4 py-3 text-right">Avg Est. Profit / Day</th>
                <th className="px-4 py-3 text-right">Total Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summaries.map(s => (
                <tr
                  key={s.weekday}
                  onClick={() => toggle(s.weekday)}
                  className={cn('cursor-pointer hover:bg-blue-50/50 tabular-nums', selected.includes(s.weekday) && 'bg-blue-50')}
                >
                  <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                    {WEEKDAY_NAMES[s.weekday]}
                    {s.weekday === best && <span className="ml-2 text-[10px] font-black uppercase text-emerald-700">Best</span>}
                    {s.weekday === slowest && <span className="ml-2 text-[10px] font-black uppercase text-amber-700">Slowest</span>}
                  </td>
                  {s.daysOpen === 0 ? (
                    <td colSpan={8} className="px-4 py-3 text-right text-slate-400">No tickets in this range</td>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right">{s.daysOpen}</td>
                      <td className="px-4 py-3 text-right">{s.tickets.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{s.avgTickets.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{money0(s.avgPayout)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{money0(s.medianPayout)}</td>
                      <td className="px-4 py-3 text-right">{lbs(s.avgWeight)}</td>
                      <td className={cn('px-4 py-3 text-right font-bold', s.avgProfit >= 0 ? 'text-emerald-700' : 'text-red-700')}>{money0(s.avgProfit)}</td>
                      <td className="px-4 py-3 text-right">{money0(s.payout)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-6 py-3 text-xs text-slate-400 border-t border-slate-100">
          "Typical day" is the median: half the days were above it, half below. One very large load moves the average a lot but the typical day hardly at all.
          {' '}{tickets.length > 0 && `${days.length} days with tickets, ${tickets.length.toLocaleString()} tickets loaded.`}
        </p>
      </section>

      {/* Dates for the picked weekdays */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:border-slate-300" aria-label="Dates for the selected days">
        <div className="p-6 pb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-slate-900 uppercase tracking-tight text-sm">
            {selected.length === 0
              ? 'Pick a day above to list its dates'
              : `Every ${WEEKDAY_ORDER.filter(w => selected.includes(w)).map(w => WEEKDAY_NAMES[w]).join(' / ')} with tickets`}
          </h3>
          <button
            onClick={downloadCsv}
            disabled={days.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 print:hidden"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            CSV {selected.length ? '(these days)' : '(all days)'}
          </button>
        </div>

        {selected.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 px-6 pb-4">
              {[
                { label: 'Days', value: selTotals.days.toLocaleString() },
                { label: 'Tickets', value: selTotals.tickets.toLocaleString() },
                { label: 'Total Payout', value: money(selTotals.payout) },
                { label: 'Total Weight', value: lbs(selTotals.weight) },
                { label: 'Est. Profit', value: money(selTotals.estProfit) }
              ].map(c => (
                <div key={c.label} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{c.label}</p>
                  <p className="text-lg font-black text-slate-900 tabular-nums">{c.value}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-right">Tickets</th>
                    <th className="px-4 py-3 text-right">Customers</th>
                    <th className="px-4 py-3 text-right">Payout</th>
                    <th className="px-4 py-3 text-right">Weight</th>
                    <th className="px-4 py-3 text-right">Est. Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedDays.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No tickets on these days in this range.</td></tr>
                  ) : selectedDays.map(d => (
                    <tr key={d.date} className="tabular-nums">
                      <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">{prettyDate(d.date)}</td>
                      <td className="px-4 py-3 text-right">{d.tickets}</td>
                      <td className="px-4 py-3 text-right">{d.customers}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{money(d.payout)}</td>
                      <td className="px-4 py-3 text-right">{lbs(d.weight)}</td>
                      <td className={cn('px-4 py-3 text-right font-bold', d.estProfit >= 0 ? 'text-emerald-700' : 'text-red-700')}>{money(d.estProfit)}</td>
                    </tr>
                  ))}
                </tbody>
                {selectedDays.length > 0 && (
                  <tfoot className="bg-slate-50 font-black text-slate-900 tabular-nums">
                    <tr>
                      <td className="px-4 py-3">Total ({selTotals.days} days)</td>
                      <td className="px-4 py-3 text-right">{selTotals.tickets}</td>
                      <td className="px-4 py-3 text-right">—</td>
                      <td className="px-4 py-3 text-right">{money(selTotals.payout)}</td>
                      <td className="px-4 py-3 text-right">{lbs(selTotals.weight)}</td>
                      <td className="px-4 py-3 text-right">{money(selTotals.estProfit)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
