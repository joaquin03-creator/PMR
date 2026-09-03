import React from 'react';
import { Scale, Layers, ArrowLeftRight } from 'lucide-react';
import { isTonMaterial, formatUnitPrice } from '../lib/scrapPricing';

interface PricingUnitBadgeProps {
  unit?: string | null;
  category?: string | null;
  materialName?: string | null;
  price?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showRate?: boolean;
  showRateBreakdown?: boolean;
  interactive?: boolean;
  onToggleUnit?: (newUnit: 'lb' | 'ton') => void;
  className?: string;
}

export const PricingUnitBadge: React.FC<PricingUnitBadgeProps> = ({
  unit,
  category,
  materialName,
  price,
  size = 'sm',
  showRate = false,
  showRateBreakdown = false,
  interactive = false,
  onToggleUnit,
  className = ''
}) => {
  const isTon = isTonMaterial(unit, category, materialName);
  const shouldShowRate = showRate || showRateBreakdown;

  const handleToggle = (e: React.MouseEvent) => {
    if (!interactive || !onToggleUnit) return;
    e.stopPropagation();
    e.preventDefault();
    onToggleUnit(isTon ? 'lb' : 'ton');
  };

  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-[9px] gap-1',
    sm: 'px-2 py-0.5 text-[10px] gap-1.5',
    md: 'px-2.5 py-1 text-xs gap-1.5',
    lg: 'px-3 py-1.5 text-sm gap-2'
  };

  const iconSizes = {
    xs: 'w-2.5 h-2.5',
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4'
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-black uppercase tracking-wider select-none border transition-all ${
        isTon
          ? 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 shadow-2xs'
          : 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 shadow-2xs'
      } ${sizeClasses[size]} ${interactive ? 'cursor-pointer hover:shadow-xs hover:scale-105 active:scale-95' : ''} ${className}`}
      title={
        interactive
          ? `Click to toggle pricing unit. Currently: ${isTon ? 'By Ton ($/NT)' : 'By Pound ($/lb)'}`
          : isTon
          ? 'Calculated by Net Ton ($/NT) — 2,000 lb per ton (Ferrous default)'
          : 'Calculated by Pound ($/lb) — (Non-Ferrous default)'
      }
      onClick={interactive ? handleToggle : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {isTon ? (
        <Layers className={`${iconSizes[size]} text-blue-600 shrink-0`} />
      ) : (
        <Scale className={`${iconSizes[size]} text-emerald-600 shrink-0`} />
      )}
      <span>{isTon ? 'By Ton ($/NT)' : 'By Pound ($/lb)'}</span>
      {shouldShowRate && price !== undefined && (
        <span className={`font-mono pl-1 border-l font-bold ${isTon ? 'border-blue-200 text-blue-800' : 'border-emerald-200 text-emerald-800'}`}>
          {formatUnitPrice(price, unit, category, materialName)}
        </span>
      )}
      {interactive && (
        <ArrowLeftRight className={`${iconSizes[size]} opacity-60 ml-0.5 text-slate-400`} />
      )}
    </span>
  );
};

export default PricingUnitBadge;
