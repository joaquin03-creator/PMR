import React from 'react';
import { cn } from '../lib/utils';

interface ArcGaugeProps {
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
  onClick
}: ArcGaugeProps) {
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
    : target
      ? `Target: ${unit === '$' ? `$${target.toLocaleString()}` : `${target} ${unit}`}`
      : null;

  return (
    <div 
      onClick={onClick}
      className={cn(
        "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 flex flex-col items-center justify-center shadow-sm transition-all relative overflow-hidden group",
        onClick && "cursor-pointer hover:border-amber-400 hover:shadow-md"
      )}
    >
      <div className="w-full max-w-[170px] aspect-[120/104] flex items-center justify-center">
        <svg viewBox="0 0 120 104" className="w-full h-full overflow-visible select-none">
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

          {/* Needle Indicator (outer portion: 35% to 80% of radius 38 => y1: -13.3, y2: -30.4) */}
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

          {/* Target or Context Subtitle Line */}
          {targetText && (
            <text
              x="60"
              y="94"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-400/80 dark:fill-slate-500 font-bold text-[7.5px]"
            >
              {targetText}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
