import React from 'react';
import { CopperTicker } from './CopperTicker';
import { WeatherWidget } from './WeatherWidget';

/** Dashboard strip of phone-style widget cards. Managers only — the copper price must not show on a cashier screen. */
export function MarketStrip() {
  return (
    <section aria-label="Market Strip" className="flex flex-wrap gap-3">
      <CopperTicker />
      <WeatherWidget />
    </section>
  );
}
