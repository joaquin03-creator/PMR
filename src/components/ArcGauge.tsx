import React, { useState } from 'react';
import { Pencil, Check, X, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ArcGaugeProps {
  title: string;
  value: number;
  formattedValue: string;
  target?: number;
  targetLabel?: string;
  unit?: string;
  color?: string;
  isMargin?: boolean;
  marginVal?: number;
  onClick?: () => void;
  editable?: boolean;
  isAutoSuggested?: boolean;
  autoDayLabel?: string;
  onSaveTarget?: (newTarget: number) => Promise<void> | void;
}

export function ArcGauge({
  title,
  value,
  formattedValue,
  target,
  targetLabel,
  unit = '',
  color = '#f59e0b',
  isMargin = false,
  marginVal = 0,
  onClick,
  editable = false,
  isAutoSuggested = false,
  autoDayLabel,
  onSaveTarget
}: ArcGaugeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(target !== undefined ? String(target) : '');
  const [isSaving, setIsSaving] = useState(false);

  // Arc angle spans 180 degrees (-90 to 90)
  // Radius = 38, cx = 60, cy = 44
  // Circumference of semi-circle = PI * r = 3.14159 * 38 ≈ 119.38
  const circumference = 119.38;

  let percentage = 0;
  if (isMargin) {
    percentage = Math.min(100, Math.max(0, (marginVal / 60) * 100)); // 0-60% scale
  } else if (target && target > 0) {
    percentage = Math.min(100, Math.max(0, (value / target) * 100));
  } else {
    percentage = 100;
  }

  const strokeDashoffset = circumference - (circumference * percentage) / 100;
  const angle = -90 + (percentage / 100) * 180;

  let activeColor = color;
  if (isMargin) {
    if (marginVal < 15) activeColor = '#ef4444'; // Red zone
    else if (marginVal < 25) activeColor = '#f59e0b'; // Amber
    else activeColor = '#10b981'; // Green
  }

  const targetText = targetLabel
    ? targetLabel
    : target !== undefined
      ? `Target: ${unit === '$' ? `$${Math.round(target).toLocaleString()}` : `${target}${unit ? ` ${unit}` : ''}`}`
      : null;

  const handleOpenEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInputValue(target !== undefined ? String(target) : '');
    setIsEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed) && parsed >= 0 && onSaveTarget) {
      setIsSaving(true);
      try {
        await onSaveTarget(parsed);
        setIsEditing(false);
      } catch (err) {
        console.error('Save target error:', err);
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <div 
      onClick={!isEditing ? onClick : undefined}
      className={cn(
        "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex flex-col items-center justify-between shadow-sm transition-all relative overflow-hidden group min-h-[148px]",
        onClick && !isEditing && "cursor-pointer hover:border-amber-400 hover:shadow-md"
      )}
    >
      {/* Manager Edit Pencil */}
      {editable && onSaveTarget && !isEditing && (
        <button
          type="button"
          onClick={handleOpenEdit}
          className="absolute top-2 right-2 p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors z-10 opacity-70 group-hover:opacity-100 cursor-pointer"
          title={`Edit ${title} Daily Target`}
          aria-label={`Edit ${title} target`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}

      {/* Inline Edit Form Overlay */}
      {isEditing && (
        <div 
          onClick={(e) => e.stopPropagation()} 
          className="absolute inset-0 bg-white dark:bg-slate-900 p-3 rounded-2xl flex flex-col justify-center items-center z-20 animate-in fade-in zoom-in-95 duration-150"
        >
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
            Edit {title} Target
          </span>
          <form onSubmit={handleSave} className="w-full flex flex-col items-center gap-2">
            <div className="relative w-full max-w-[130px]">
              {unit === '$' && (
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  $
                </span>
              )}
              <input
                type="number"
                step={isMargin ? "0.1" : "1"}
                min="0"
                autoFocus
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Target"
                className={cn(
                  "w-full text-center text-xs font-bold py-1.5 px-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white",
                  unit === '$' && "pl-6",
                  unit === '%' && "pr-6"
                )}
              />
              {unit === '%' && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  %
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 w-full max-w-[130px] justify-center">
              <button
                type="submit"
                disabled={isSaving || inputValue.trim() === '' || isNaN(Number(inputValue))}
                className="flex-1 py-1 px-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-1 cursor-pointer"
              >
                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                <span>Save</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(false);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SVG Arc Gauge */}
      <div className="w-full max-w-[150px] aspect-[120/92] flex items-center justify-center">
        <svg viewBox="0 0 120 96" className="w-full h-full overflow-visible select-none">
          {/* Background Arc */}
          <path
            d="M 22 44 A 38 38 0 0 1 98 44"
            fill="none"
            stroke="#f1f5f9"
            className="dark:stroke-slate-800"
            strokeWidth="9"
            strokeLinecap="round"
          />

          {/* Red Zone Shading for Margin Gauge (0 - 15% out of 60% = 25% arc) */}
          {isMargin && (
            <path
              d="M 22 44 A 38 38 0 0 1 98 44"
              fill="none"
              stroke="#fee2e2"
              className="dark:stroke-rose-950/40"
              strokeWidth="9"
              strokeDasharray="119.38"
              strokeDashoffset={119.38 - (119.38 * 0.25)}
              strokeLinecap="round"
            />
          )}

          {/* Active Filled Arc */}
          <path
            d="M 22 44 A 38 38 0 0 1 98 44"
            fill="none"
            stroke={activeColor}
            strokeWidth="9"
            strokeDasharray="119.38"
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />

          {/* Pivot Hub */}
          <circle cx="60" cy="44" r="5" className="fill-slate-900 dark:fill-slate-100" />

          {/* Needle Indicator */}
          <g transform={`translate(60, 44) rotate(${angle})`}>
            <line
              x1="0"
              y1="-13.3"
              x2="0"
              y2="-30.4"
              className="stroke-slate-900 dark:stroke-slate-100"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>

          {/* Large Numeric Value Text */}
          <text
            x="60"
            y="65"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-slate-900 dark:fill-white font-black text-[15px] font-display tracking-tight"
          >
            {formattedValue}
          </text>

          {/* Gauge Label (Title) */}
          <text
            x="60"
            y="81"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-slate-400 dark:fill-slate-400 font-extrabold text-[8.5px] uppercase tracking-wider"
          >
            {title}
          </text>

          {/* Target Text inside SVG */}
          {targetText && (
            <text
              x="60"
              y="93"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-500 dark:fill-slate-400 font-bold text-[7.5px]"
            >
              {targetText}
            </text>
          )}
        </svg>
      </div>

      {/* Auto-suggested indicator - shown only when using auto-suggested smart defaults */}
      {isAutoSuggested && autoDayLabel && (
        <div className="w-full flex items-center justify-center gap-1 text-[8.5px] font-semibold text-amber-600 dark:text-amber-400 pt-0.5 border-t border-slate-100 dark:border-slate-800/80">
          <Sparkles className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">Based on last {autoDayLabel}</span>
        </div>
      )}
    </div>
  );
}

