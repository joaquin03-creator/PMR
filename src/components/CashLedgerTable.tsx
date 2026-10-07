import { RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { LedgerRow } from '../lib/ledgerRows';

interface CashLedgerTableProps {
  rows: LedgerRow[];
  todayStr: string;
  /** Tickets (and so Money Out) are loaded for every day on or after this date. */
  ticketsLoadedFromDate: string;
  loadingEarlierTickets: boolean;
  onLoadEarlierTickets: () => void;
  canShowEarlierDays: boolean;
  onShowEarlierDays: () => void;
  onOpenDay: (row: LedgerRow) => void;
  /** Session ids that already have a count and can be closed in one click. */
  closableSessionIds: Set<string>;
  onCloseDay: (row: LedgerRow) => void;
  processing: boolean;
}

const money = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signedMoney = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}$${money(Math.abs(value))}`;

const STATUS_STYLE: Record<LedgerRow['status'], { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  closed: { label: 'Closed', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  provisional: { label: 'Provisional', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  none: { label: 'No session', className: 'bg-slate-100 text-slate-500 border-slate-200' }
};

/**
 * Historical Ledgers: every day in one table, read like a single day's cash sheet.
 * Starting Count + Money In − Money Out = expected; Over/Short = Final Count − expected.
 * Display only -- nothing here writes or corrects a record.
 */
export default function CashLedgerTable({
  rows,
  todayStr,
  ticketsLoadedFromDate,
  loadingEarlierTickets,
  onLoadEarlierTickets,
  canShowEarlierDays,
  onShowEarlierDays,
  onOpenDay,
  closableSessionIds,
  onCloseDay,
  processing
}: CashLedgerTableProps) {
  const hasUnloadedRows = rows.some(r => r.sessionId && r.date < ticketsLoadedFromDate);

  const loadLink = (
    <button
      type="button"
      onClick={onLoadEarlierTickets}
      disabled={loadingEarlierTickets}
      className="text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-800 disabled:opacity-50 cursor-pointer"
    >
      {loadingEarlierTickets ? 'loading…' : 'load'}
    </button>
  );

  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-left min-w-[860px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
              <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Starting Count</th>
              <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Money In</th>
              <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Money Out</th>
              <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Final Count</th>
              <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Over / Short</th>
              <th className="px-5 py-3.5" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400 font-medium">
                  No cash sessions recorded yet.
                </td>
              </tr>
            )}
            {rows.map(row => {
              const status = STATUS_STYLE[row.status];
              const muted = row.status === 'none';
              return (
                <tr key={row.key} className={cn('transition-colors hover:bg-slate-50/60', muted && 'bg-slate-50/40')}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={cn('font-mono font-bold text-sm', muted ? 'text-slate-500' : 'text-slate-900')}>{row.date}</span>
                      {row.date === todayStr && (
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">today</span>
                      )}
                      <span className={cn('text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border', status.className)}>
                        {status.label}
                      </span>
                    </div>
                  </td>

                  {/* Starting Count (+ quiet carry-forward flag) */}
                  <td className="px-5 py-3 text-right font-mono text-sm">
                    {row.startingCount === null ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-slate-900">${money(row.startingCount)}</span>
                        {row.carryForward && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-sans font-semibold text-amber-700 cursor-help"
                            title={`Starting Count differs from ${row.carryForward.priorDate}'s Final Count ($${money(row.carryForward.priorFinal)}) by ${signedMoney(row.carryForward.difference)}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                            {signedMoney(row.carryForward.difference)} vs prior day
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Money In */}
                  <td className="px-5 py-3 text-right font-mono text-sm">
                    {row.moneyIn === null ? (
                      <span className="text-slate-300">{row.sessionId ? '…' : '—'}</span>
                    ) : (
                      <span className={row.moneyIn > 0 ? 'font-bold text-emerald-700' : 'text-slate-400'}>${money(row.moneyIn)}</span>
                    )}
                  </td>

                  {/* Money Out */}
                  <td className="px-5 py-3 text-right font-mono text-sm">
                    {row.moneyOut === null ? (
                      row.sessionId && row.date < ticketsLoadedFromDate ? loadLink : <span className="text-slate-300">…</span>
                    ) : (
                      <span
                        className={cn(row.moneyOut > 0 ? 'font-bold text-red-700' : 'text-slate-400', 'cursor-help')}
                        title={
                          row.payouts !== null && row.expenses !== null
                            ? `Ticket payouts $${money(row.payouts)} (${row.ticketCount ?? 0} ticket${row.ticketCount === 1 ? '' : 's'}) + expenses $${money(row.expenses)}`
                            : `Ticket payouts $${money(row.moneyOut)} (${row.ticketCount ?? 0} ticket${row.ticketCount === 1 ? '' : 's'})`
                        }
                      >
                        ${money(row.moneyOut)}
                      </span>
                    )}
                  </td>

                  {/* Final Count */}
                  <td className="px-5 py-3 text-right font-mono text-sm">
                    {row.finalKind === 'counted' && row.finalCount !== null && (
                      <span className="font-bold text-slate-900">${money(row.finalCount)}</span>
                    )}
                    {row.finalKind === 'assumed' && row.finalCount !== null && (
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-amber-700">${money(row.finalCount)}</span>
                        <span className="text-[10px] font-sans font-semibold text-amber-700">assumed — not counted</span>
                      </div>
                    )}
                    {row.finalKind === 'none' && (
                      <span className="text-xs font-sans italic text-slate-400">{muted ? '—' : 'not counted'}</span>
                    )}
                  </td>

                  {/* Over / Short */}
                  <td className="px-5 py-3 text-right font-mono text-sm">
                    {row.overShortState === 'value' && row.overShort !== null && (
                      <div className="flex flex-col items-end">
                        <span
                          className={cn(
                            'font-bold',
                            Math.abs(row.overShort) < 0.005 ? 'text-slate-500' : row.overShort > 0 ? 'text-emerald-700' : 'text-red-700'
                          )}
                          title={row.expected !== null ? `Expected $${money(row.expected)}` : undefined}
                        >
                          {signedMoney(row.overShort)}
                        </span>
                        {row.storedOverShortDiffers && row.storedOverShort !== null && (
                          <span
                            className="text-[10px] font-sans font-semibold text-amber-700 cursor-help"
                            title="The over/short saved on this day's record does not match the figure computed from its opening, cash in, payouts and expenses."
                          >
                            record says {signedMoney(row.storedOverShort)}
                          </span>
                        )}
                      </div>
                    )}
                    {row.overShortState === 'pending' && (
                      <span className="text-xs font-sans italic text-slate-400">{muted ? '—' : 'pending'}</span>
                    )}
                    {row.overShortState === 'unknown' && (
                      row.date < ticketsLoadedFromDate ? loadLink : <span className="text-slate-300">…</span>
                    )}
                  </td>

                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {row.sessionId && closableSessionIds.has(row.sessionId) && (
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => onCloseDay(row)}
                          className="text-[10px] font-black uppercase tracking-wider text-emerald-700 hover:text-emerald-900 disabled:opacity-50 cursor-pointer"
                        >
                          Close Day
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenDay(row)}
                        className="text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-blue-700 cursor-pointer"
                      >
                        Open
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Each row reads like the day's cash sheet: Starting Count + Money In − Money Out = expected, and Over / Short = Final Count − expected.
          A small amber note under Starting Count means it does not match the prior day's Final Count.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {hasUnloadedRows && (
            <button
              type="button"
              onClick={onLoadEarlierTickets}
              disabled={loadingEarlierTickets}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2"
            >
              {loadingEarlierTickets && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {loadingEarlierTickets ? 'Loading…' : 'Load Money Out for earlier days'}
            </button>
          )}
          {canShowEarlierDays && (
            <button
              type="button"
              onClick={onShowEarlierDays}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
            >
              Show earlier days
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
