export const LBS_PER_TON = 2000;

/**
 * Determines whether a material is measured/priced in tons or is ferrous.
 * Non-ferrous materials (Copper, Brass, Aluminum, Lead, Zinc, Stainless, Batteries, etc.)
 * are ALWAYS priced by the pound ($/lb) unless explicitly configured with unit="ton".
 */
export function isTonMaterial(
  unit?: string | null,
  category?: string | null,
  materialName?: string | null
): boolean {
  const normUnit = (unit || '').toLowerCase().trim();
  const normCategory = (category || '').toLowerCase().trim();
  const normName = (materialName || '').toLowerCase().trim();

  // 1. Explicit Ton Unit on material or ticket item (e.g. 'ton', 'nt', 'gt', 'net ton')
  const isExplicitTonUnit = (
    normUnit === 'ton' ||
    normUnit === 'tons' ||
    normUnit === 'nt' ||
    normUnit === 'gt' ||
    normUnit === 'net ton' ||
    normUnit === 'gross ton' ||
    normUnit === 't' ||
    normUnit === 'tn' ||
    normUnit.includes('/ton') ||
    normUnit.includes('/nt') ||
    normUnit.includes('/gt')
  );

  if (isExplicitTonUnit) {
    return true;
  }

  // 2. Strict NON-FERROUS checks:
  // Any Non-Ferrous category or commodity is strictly priced per pound ($/lb).
  const isNonFerrousCategory = (
    normCategory === 'non-ferrous' ||
    normCategory === 'non ferrous' ||
    normCategory === 'nonferrous' ||
    normCategory.includes('non-ferrous') ||
    normCategory.includes('non ferrous') ||
    normCategory.includes('nonferrous') ||
    normCategory === 'copper' ||
    normCategory.includes('copper') ||
    normCategory === 'brass' ||
    normCategory.includes('brass') ||
    normCategory === 'aluminum' ||
    normCategory.includes('aluminum') ||
    normCategory === 'lead' ||
    normCategory.includes('lead') ||
    normCategory === 'zinc' ||
    normCategory.includes('zinc') ||
    normCategory === 'stainless' ||
    normCategory.includes('stainless') ||
    normCategory === 'battery' ||
    normCategory.includes('battery') ||
    normCategory === 'batteries' ||
    normCategory.includes('batteries') ||
    normCategory === 'catalytic' ||
    normCategory.includes('catalytic') ||
    normCategory === 'electronic' ||
    normCategory.includes('electronic')
  );

  const isNonFerrousName = (
    normName.includes('non-ferrous') ||
    normName.includes('non ferrous') ||
    normName.includes('nonferrous') ||
    normName.includes('copper') ||
    normName.includes('bare bright') ||
    normName.includes('brass') ||
    normName.includes('aluminum') ||
    normName.includes('stainless') ||
    normName.includes('lead') ||
    normName.includes('zinc') ||
    normName.includes('battery') ||
    normName.includes('batteries') ||
    normName.includes('catalytic') ||
    normName.includes('electric motor') ||
    normName.includes('starter') ||
    normName.includes('alternator') ||
    normName.includes('compressor') ||
    normName.includes('wire') ||
    normName.includes('harness') ||
    normName.includes('radiator') ||
    normName.includes('heater core') ||
    normName.includes('magnesium') ||
    normName.includes('titanium') ||
    normName.includes('carbide')
  );

  if (isNonFerrousCategory || isNonFerrousName) {
    return false;
  }

  // 3. If explicitly marked as lb / pound / lbs, respect per-pound pricing
  const isExplicitLbUnit = (
    normUnit === 'lb' ||
    normUnit === 'lbs' ||
    normUnit === 'pound' ||
    normUnit === 'pounds' ||
    normUnit.includes('/lb') ||
    normUnit.includes('/lbs')
  );

  if (isExplicitLbUnit) {
    return false;
  }

  // 4. Ferrous commodities (when unit is unset, empty, or ton)
  const isStrictlyFerrousCategory = (
    (normCategory === 'ferrous' || (normCategory.includes('ferrous') && !normCategory.includes('non'))) ||
    normCategory === 'steel' ||
    normCategory === 'sheet iron' ||
    normCategory === 'shred' ||
    normCategory === 'shredded' ||
    normCategory === 'cast iron' ||
    normCategory === 'hms' ||
    normCategory === 'heavy melt' ||
    normCategory === 'busheling' ||
    normCategory === 'p&s' ||
    normCategory.includes('plate & structural')
  );

  const isStrictlyFerrousName = (
    (normName.includes('ferrous') && !normName.includes('non')) ||
    normName.includes('sheet iron') ||
    normName.includes('shred') ||
    normName.includes('cast iron') ||
    normName.includes('heavy melt') ||
    normName.includes('hms') ||
    normName.includes('prepared steel') ||
    normName.includes('unprepared steel') ||
    normName.includes('busheling') ||
    normName.includes('plate & structural') ||
    normName.includes('tin / sheet')
  );

  if (isStrictlyFerrousCategory || isStrictlyFerrousName) {
    return true;
  }

  return false;
}

/**
 * Returns formatted rate unit string (/NT or /lb).
 */
export function getRateUnitLabel(
  unit?: string | null,
  category?: string | null,
  materialName?: string | null
): '/NT' | '/lb' {
  return isTonMaterial(unit, category, materialName) ? '/NT' : '/lb';
}

/**
 * Formats a unit price with its scrap industry unit (e.g. $220/NT or $3.50/lb).
 */
export function formatUnitPrice(
  price: number,
  unit?: string | null,
  category?: string | null,
  materialName?: string | null
): string {
  const isTon = isTonMaterial(unit, category, materialName);
  const p = Number(price) || 0;
  const priceFormatted = p % 1 === 0 ? `$${p}` : `$${p.toFixed(2)}`;
  return isTon ? `${priceFormatted}/NT` : `$${p.toFixed(2)}/lb`;
}

/**
 * Calculates line item values: net weight, paid weight (in lbs), effective billing units (lbs or tons), and total payout.
 * Scales measure gross, tare, and deduction weights in pounds (lbs).
 * If the material unit is 'ton', effective units = paid weight in lbs / 2000.
 */
export function calculateMaterialLineItem(
  grossWeight: number,
  tareWeight: number,
  deductionWeight: number = 0,
  pricePerUnit: number = 0,
  unit?: string | null,
  category?: string | null,
  materialName?: string | null
) {
  const gross = Number(grossWeight) || 0;
  const tare = Number(tareWeight) || 0;
  const deduction = Number(deductionWeight) || 0;
  const price = Number(pricePerUnit) || 0;

  const physicalNet = Math.max(0, gross - tare);
  const paidWeightLbs = Math.max(0, physicalNet - deduction);
  const isTon = isTonMaterial(unit, category, materialName);

  const effectiveUnits = isTon ? (paidWeightLbs / LBS_PER_TON) : paidWeightLbs;
  const totalAmount = Math.round(effectiveUnits * price * 100) / 100;

  return {
    grossWeight: gross,
    tareWeight: tare,
    netWeight: physicalNet,
    deductionWeight: deduction,
    paidWeightLbs,
    effectiveUnits,
    isTon,
    unit: isTon ? ('ton' as const) : ('lb' as const),
    pricePerUnit: price,
    totalAmount,
    unitLabel: isTon ? ('/NT' as const) : ('/lb' as const),
  };
}

/**
 * Formats weight and rate breakdown string for ticket history and printed receipts.
 */
export function formatRateBreakdown(
  paidWeightLbs: number,
  pricePerUnit: number,
  unit?: string | null,
  category?: string | null,
  materialName?: string | null
): { weightDisplay: string; rateDisplay: string; summaryDisplay: string; tons: number; isTon: boolean } {
  const isTon = isTonMaterial(unit, category, materialName);
  const price = Number(pricePerUnit) || 0;
  const tons = paidWeightLbs / LBS_PER_TON;
  const priceStr = price % 1 === 0 ? `$${price}` : `$${price.toFixed(2)}`;

  if (isTon) {
    const tonsFormatted = tons.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    const weightDisplay = `${paidWeightLbs.toLocaleString()} lb (${tonsFormatted} NT)`;
    const rateDisplay = `${priceStr}/NT`;
    const summaryDisplay = `${paidWeightLbs.toLocaleString()} lb (${tonsFormatted} NT) paid @ ${priceStr}/NT`;
    return { weightDisplay, rateDisplay, summaryDisplay, tons, isTon: true };
  }

  const weightDisplay = `${paidWeightLbs.toLocaleString()} lb`;
  const rateDisplay = `$${price.toFixed(2)}/lb`;
  const summaryDisplay = `${paidWeightLbs.toLocaleString()} lb paid @ $${price.toFixed(2)}/lb`;
  return { weightDisplay, rateDisplay, summaryDisplay, tons, isTon: false };
}

