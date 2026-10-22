import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Profit margin on resale, the same way the Dashboard's Margin % gauge works it out:
 * (sale − buy) / sale × 100. Null when there is no sale price to divide by.
 */
export function marginPercent(buyPrice: number, salePrice: number): number | null {
  const buy = Number(buyPrice);
  const sale = Number(salePrice);
  if (!Number.isFinite(buy) || !Number.isFinite(sale) || sale <= 0) return null;
  return ((sale - buy) / sale) * 100;
}

export interface MarginPreviewProps {
  currentBuy: number;
  currentSale: number;
  newBuy: number;
  newSale: number;
  unit: string;
  /** The shop's margin target (Dashboard Margin % gauge), if one is set. */
  target?: number | null;
}

const pct = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

/** Live preview of how a price edit changes a material's profit margin, shown before saving. */
export function MarginPreview({ currentBuy, currentSale, newBuy, newSale, unit, target }: MarginPreviewProps) {
  const before = marginPercent(currentBuy, currentSale);
  const after = marginPercent(newBuy, newSale);
  const changed = Number(currentBuy) !== Number(newBuy) || Number(currentSale) !== Number(newSale);
  const hasTarget = typeof target === 'number' && target > 0;

  const tone =
    after === null ? 'slate'
      : after <= 0 ? 'red'
      : hasTarget ? (after >= target! ? 'green' : 'amber')
      : 'slate';

  const toneClasses = {
    slate: 'bg-slate-50 border-slate-200',
    green: 'bg-emerald-50 border-emerald-200',
    amber: 'bg-amber-50 border-amber-200',
    red: 'bg-red-50 border-red-200'
  }[tone];
  const toneText = {
    slate: 'text-slate-900',
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700'
  }[tone];

  const delta = before !== null && after !== null ? after - before : null;

  return (
    <div className={cn('mx-5 mb-4 p-4 rounded-xl border space-y-2 transition-colors', toneClasses)} aria-live="polite">
      <p className="text-xs font-medium text-slate-500 uppercase">Profit Margin {changed ? 'Preview' : ''}</p>

      {after === null ? (
        <p className="text-sm font-semibold text-slate-500">Enter a sale price to see the margin.</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className={cn('text-2xl font-black leading-none tabular-nums', toneText)}>{pct(after)}</p>
              <p className="text-xs font-semibold text-slate-500 mt-1 tabular-nums">
                {money(Number(newSale) - Number(newBuy))} per {unit} spread
              </p>
            </div>
            {changed && delta !== null && (
              <div className="text-right">
                <p className={cn(
                  'text-sm font-black flex items-center justify-end gap-1 tabular-nums',
                  Math.abs(delta) < 0.05 ? 'text-slate-500' : delta > 0 ? 'text-emerald-700' : 'text-red-700'
                )}>
                  {Math.abs(delta) < 0.05 ? <Minus className="w-4 h-4" /> : delta > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {delta > 0 ? '+' : delta < 0 ? '−' : ''}{Math.abs(delta).toFixed(1)} pts
                </p>
                <p className="text-xs font-semibold text-slate-500 tabular-nums">
                  was {pct(before!)} ({money(Number(currentSale) - Number(currentBuy))} per {unit})
                </p>
              </div>
            )}
          </div>

          {after <= 0 ? (
            <p className="text-xs font-bold text-red-700">Buy price is at or above the sale price: this material would lose money.</p>
          ) : hasTarget ? (
            <p className={cn('text-xs font-bold', toneText)}>
              {after >= target!
                ? `Meets the ${pct(target!)} margin target (+${(after - target!).toFixed(1)} pts).`
                : `${(target! - after).toFixed(1)} pts below the ${pct(target!)} margin target.`}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
