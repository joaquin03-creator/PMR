import React from 'react';
import { cn } from '../lib/utils';

export interface CopperTickerProps {
  /**
   * TradingView symbol. If the widget shows "symbol not available", use "CAPITALCOM:COPPER" instead.
   * (Checked 2026-10-22: the free widget shows "This symbol is only available on TradingView" for
   * COMEX:HG1!, so the default is CAPITALCOM:COPPER, Capital.com's copper price, which tracks COMEX copper.)
   */
  symbol?: string;
  label?: string;
  className?: string;
}

// TradingView's Single Ticker widget, sealed off from the app. Their embed script
// (embed-widget-single-quote.js) only builds an iframe pointing at this address; we
// build the same iframe ourselves so none of TradingView's code runs in the app's own
// page, where the signed-in session lives. The frame is on TradingView's origin, so the
// browser keeps it out of the app; the sandbox also stops it from navigating the app's
// tab. Popups stay allowed so a click still opens TradingView in a new tab.
const WIDGET_HOST = 'https://www.tradingview-widget.com';
const WIDGET_HEIGHT = 101; // the height TradingView's script forces for this widget
// The price box inside that frame is ~67px tall with a 1px outline; the rest is empty.
// The card shows only the box, with the outline cropped off, so the strip stays short.
const VISIBLE_HEIGHT = 63;
const CROP = 2; // px trimmed off each edge of the frame to hide the outline

function widgetUrl(symbol: string): string {
  const settings = {
    symbol,
    width: '100%',
    height: WIDGET_HEIGHT,
    colorTheme: 'dark',
    isTransparent: true,
    // TradingView's script sends the embedding page here; the host alone is enough.
    'page-uri': `${window.location.host}/`
  };
  return `${WIDGET_HOST}/embed-widget/single-quote/?locale=en#${encodeURIComponent(JSON.stringify(settings))}`;
}

/** Live copper price from TradingView's free Single Ticker widget. */
export function CopperTicker({ symbol = 'CAPITALCOM:COPPER', label = 'Copper · Live', className }: CopperTickerProps) {
  return (
    <div
      className={cn(
        'rounded-[22px] pl-4 pr-3 py-2.5 text-white shadow-lg flex items-center gap-3 w-[340px] max-w-full overflow-hidden',
        'bg-[linear-gradient(135deg,#3a2316_0%,#8a4b25_55%,#b8733a_100%)]',
        className
      )}
    >
      <span className="text-[10px] font-black uppercase tracking-wider text-white/70 leading-tight shrink-0">
        {label.split(' · ').map(part => <span key={part} className="block">{part}</span>)}
      </span>
      <div className="relative flex-1 min-w-0 overflow-hidden" style={{ height: VISIBLE_HEIGHT }}>
        <iframe
          key={symbol}
          src={widgetUrl(symbol)}
          title={`${label} price`}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="origin"
          scrolling="no"
          className="absolute border-0 bg-transparent select-none"
          style={{ top: -CROP, left: -CROP, width: `calc(100% + ${CROP * 2}px)`, height: WIDGET_HEIGHT, colorScheme: 'normal' }}
        />
      </div>
    </div>
  );
}
