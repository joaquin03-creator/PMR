// Google Sheet price sync: was a material's price changed in the app since the sheet last set it?
//
// Each sync records on every material it matches the prices the sheet gave it (`sheetSync`).
// A material whose app prices differ from that mark was changed in the app (edit form, batch
// update, revert, another station) and the next sync would overwrite that change.
// Materials synced before the mark existed fall back to time: updated after the last sync.

import { Material } from '../types';

const SAME_PRICE = 0.0005;
// The sync itself stamps updatedAt a moment after the recorded sync time.
const SYNC_WRITE_WINDOW_MS = 2 * 60 * 1000;

export function changedInAppSinceSync(
  material: Pick<Material, 'buyPrice' | 'salePrice' | 'updatedAt' | 'sheetSync'>,
  lastSyncAt?: string | null
): boolean {
  const mark = material.sheetSync;
  if (mark) {
    return Math.abs(material.buyPrice - mark.buyPrice) > SAME_PRICE ||
      Math.abs(material.salePrice - mark.salePrice) > SAME_PRICE;
  }
  if (!lastSyncAt || !material.updatedAt) return false;
  const updated = Date.parse(material.updatedAt);
  const synced = Date.parse(lastSyncAt);
  if (Number.isNaN(updated) || Number.isNaN(synced)) return false;
  return updated > synced + SYNC_WRITE_WINDOW_MS;
}

// The latest of the stored sync time and the newest pre-sync snapshot (whichever exists).
export function latestSyncTime(...times: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const t of times) {
    if (!t || Number.isNaN(Date.parse(t))) continue;
    if (!best || Date.parse(t) > Date.parse(best)) best = t;
  }
  return best;
}
