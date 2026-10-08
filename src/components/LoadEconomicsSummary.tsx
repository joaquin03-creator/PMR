import { useMemo } from 'react';
import { BuyTicket, ExternalSale, Invoice, Material, MaterialConversion, ProcessingShrinkAdjustment } from '../types';
import { computePeriodEconomics } from '../lib/loadEconomics';
import { TrendingUp, TrendingDown, DollarSign, HelpCircle, FileImage, MessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';

interface LoadEconomicsSummaryProps {
  invoice: Invoice;
  shrinkAdjustments: ProcessingShrinkAdjustment[];
  buyTickets: BuyTicket[];
  conversions: MaterialConversion[];
  invoices: Invoice[];
  sales: ExternalSale[];
  materials: Material[];
}

// Per-load-cycle economics: the period runs from the PREVIOUS reconciled
// invoice's reconciliation up to this one's. Revenue is attributed the same
// way the Variance Dashboard already attributes "sold" for its
// expected-vs-actual calc (paid invoices by date), plus external sales.
export function LoadEconomicsSummary({ invoice, shrinkAdjustments, buyTickets, conversions, invoices, sales, materials }: LoadEconomicsSummaryProps) {
  const thisAdjustment = useMemo(
    () => shrinkAdjustments.find(a => a.invoiceId === invoice.id) || null,
    [shrinkAdjustments, invoice.id]
  );

  const result = useMemo(() => {
    if (!thisAdjustment) return null;

    const priorAdjustments = shrinkAdjustments
      .filter(a => a.timestamp < thisAdjustment.timestamp)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const priorAdjustment = priorAdjustments[0] || null;

    const periodStart = priorAdjustment?.timestamp || '1970-01-01T00:00:00.000Z';
    const periodEnd = thisAdjustment.timestamp;

    const onHandWeightAtStart: Record<string, number> = {};
    (priorAdjustment?.materialDeltas || []).forEach(d => { onHandWeightAtStart[d.materialId] = d.physicalWeight; });

    const onHandWeightAtEnd: Record<string, number> = {};
    thisAdjustment.materialDeltas.forEach(d => { onHandWeightAtEnd[d.materialId] = d.physicalWeight; });

    const revenueFromInvoices = invoices
      .filter(inv => inv.status === 'paid' && (inv.date || '') > periodStart && (inv.date || '') <= periodEnd)
      .reduce((sum, inv) => sum + inv.totalAmount, 0);
    const revenueFromSales = sales
      .filter(s => (s.date || '') > periodStart && (s.date || '') <= periodEnd)
      .reduce((sum, s) => sum + (s.totalRevenue ?? s.salePrice * s.weight), 0);

    return computePeriodEconomics({
      periodStart,
      periodEnd,
      buyTickets,
      conversions,
      shrinkAdjustment: thisAdjustment,
      shipmentRevenue: revenueFromInvoices + revenueFromSales,
      materials,
      onHandWeightAtStart,
      onHandWeightAtEnd,
    });
  }, [thisAdjustment, buyTickets, conversions, invoices, sales, materials]);

  if (!result) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-[2rem] p-6 space-y-5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Shipment Economics</h3>
        <HelpCircle className="w-3.5 h-3.5 text-slate-300" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Upgrade Gain</p>
          <p className="font-mono font-black text-emerald-600 text-lg">{Math.round(result.upgradeGainLbs).toLocaleString()} lbs</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Shrink</p>
          <p className="font-mono font-black text-amber-600 text-lg">{result.shrinkPercentOfPurchased.toFixed(1)}%</p>
          <p className="text-[9px] text-slate-400">{Math.round(result.shrinkLbs).toLocaleString()} lbs of {Math.round(result.purchasedWeightLbs).toLocaleString()} purchased</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Unexplained Variance</p>
          <p className={cn('font-mono font-black text-lg', result.unexplainedVarianceLbs < 0 ? 'text-red-600' : 'text-blue-600')}>
            {result.unexplainedVarianceLbs > 0 ? '+' : ''}{Math.round(result.unexplainedVarianceLbs).toLocaleString()} lbs
          </p>
        </div>
        <div className="bg-slate-900 rounded-xl p-4">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Realized Margin (at cost)</p>
          <div className="flex items-center gap-1.5">
            {result.realizedMarginAtCost >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
            <p className="font-mono font-black text-white text-lg">
              ${Math.round(result.realizedMarginAtCost).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl text-xs">
        <span className="font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <DollarSign className="w-3.5 h-3.5" /> Realized Margin (at sell price)
        </span>
        {result.hasSellPriceForAllMaterials ? (
          <span className="font-mono font-black text-slate-900">${Math.round(result.realizedMarginAtSell!).toLocaleString()}</span>
        ) : (
          <span className="text-slate-400 font-medium italic">Not all materials have a sell price set</span>
        )}
      </div>

      {(thisAdjustment?.slipPhotoUrl || thisAdjustment?.notes) && (
        <div className="flex items-start gap-4 pt-4 border-t border-slate-100">
          {thisAdjustment.slipPhotoUrl && (
            <a href={thisAdjustment.slipPhotoUrl} target="_blank" rel="noreferrer" className="shrink-0">
              <img
                src={thisAdjustment.slipPhotoUrl}
                alt="Receiving slip"
                className="w-16 h-16 object-cover rounded-xl border border-slate-200 hover:border-blue-400 transition-colors"
              />
            </a>
          )}
          <div className="flex-1 min-w-0">
            {thisAdjustment.slipPhotoUrl && (
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1 mb-1">
                <FileImage className="w-3 h-3" /> Receiving slip attached &mdash; click to view
              </p>
            )}
            {thisAdjustment.notes && (
              <p className="text-xs text-slate-600 font-medium flex items-start gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                {thisAdjustment.notes}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
