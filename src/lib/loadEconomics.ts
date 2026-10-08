import { BuyTicket, Material, MaterialConversion, ProcessingShrinkAdjustment } from '../types';

export interface PeriodEconomicsInput {
  /** Exclusive start of the period -- typically the previous load's reconciliation timestamp. */
  periodStart: string;
  /** Inclusive end of the period -- this load's reconciliation timestamp. */
  periodEnd: string;
  buyTickets: BuyTicket[];
  conversions: MaterialConversion[];
  shrinkAdjustment: ProcessingShrinkAdjustment;
  shipmentRevenue: number;
  materials: Material[];
  onHandWeightAtStart: Record<string, number>;
  onHandWeightAtEnd: Record<string, number>;
}

export interface PeriodEconomicsResult {
  purchasedWeightLbs: number;
  purchasedDollars: number;
  upgradeGainLbs: number;
  shrinkLbs: number;
  shrinkPercentOfPurchased: number;
  unexplainedVarianceLbs: number;
  shipmentRevenue: number;
  onHandValueAtCostStart: number;
  onHandValueAtCostEnd: number;
  realizedMarginAtCost: number;
  onHandValueAtSellStart: number | null;
  onHandValueAtSellEnd: number | null;
  realizedMarginAtSell: number | null;
  hasSellPriceForAllMaterials: boolean;
}

const inPeriod = (timestamp: string, start: string, end: string) => timestamp > start && timestamp <= end;

export function computePeriodEconomics(input: PeriodEconomicsInput): PeriodEconomicsResult {
  const { periodStart, periodEnd, buyTickets, conversions, shrinkAdjustment, shipmentRevenue, materials, onHandWeightAtStart, onHandWeightAtEnd } = input;

  const periodTickets = buyTickets.filter(t => t.status === 'completed' && inPeriod(t.timestamp, periodStart, periodEnd));
  const purchasedWeightLbs = periodTickets.reduce((sum, t) => sum + (t.materials || []).reduce((s, m) => s + (m.netWeight || 0), 0), 0);
  const purchasedDollars = periodTickets.reduce((sum, t) => sum + t.totalAmount, 0);

  const periodConversions = conversions.filter(c => c.status === 'completed' && inPeriod(c.timestamp, periodStart, periodEnd));

  const materialPrice = (materialId: string) => materials.find(m => m.id === materialId)?.buyPrice ?? 0;

  let upgradeGainLbs = 0;
  let shrinkLbs = 0;
  periodConversions.forEach(c => {
    const sourcePrice = materialPrice(c.sourceMaterialId);
    const destinations = c.destinations && c.destinations.length > 0
      ? c.destinations
      : (c.destinationMaterialId ? [{ destinationMaterialId: c.destinationMaterialId, producedWeight: c.producedWeight || 0, yieldPercent: c.yieldPercent || 0 }] : []);

    let totalProduced = 0;
    destinations.forEach(d => {
      totalProduced += d.producedWeight;
      if (materialPrice(d.destinationMaterialId) > sourcePrice) {
        upgradeGainLbs += d.producedWeight;
      }
    });
    shrinkLbs += Math.max(0, c.consumedWeight - totalProduced);
  });

  const shrinkPercentOfPurchased = purchasedWeightLbs > 0 ? (shrinkLbs / purchasedWeightLbs) * 100 : 0;

  // Unexplained variance: the reconciliation's own booked gap -- by
  // construction this is whatever's left after logged conversions already
  // moved book weight around. Net, not absolute, so over/short direction is
  // preserved (positive = drawer had more than expected, negative = less).
  const unexplainedVarianceLbs = shrinkAdjustment.materialDeltas.reduce((sum, d) => sum + d.delta, 0);

  const onHandValueAtCostStart = Object.entries(onHandWeightAtStart).reduce((sum, [matId, weight]) => sum + weight * materialPrice(matId), 0);
  const onHandValueAtCostEnd = Object.entries(onHandWeightAtEnd).reduce((sum, [matId, weight]) => sum + weight * materialPrice(matId), 0);
  const realizedMarginAtCost = shipmentRevenue - purchasedDollars + (onHandValueAtCostEnd - onHandValueAtCostStart);

  const allMaterialIds = new Set([...Object.keys(onHandWeightAtStart), ...Object.keys(onHandWeightAtEnd)]);
  const hasSellPriceForAllMaterials = Array.from(allMaterialIds).every(matId => {
    const mat = materials.find(m => m.id === matId);
    return mat && typeof mat.salePrice === 'number' && mat.salePrice > 0;
  });

  let onHandValueAtSellStart: number | null = null;
  let onHandValueAtSellEnd: number | null = null;
  let realizedMarginAtSell: number | null = null;
  if (hasSellPriceForAllMaterials) {
    const salePrice = (materialId: string) => materials.find(m => m.id === materialId)?.salePrice ?? 0;
    onHandValueAtSellStart = Object.entries(onHandWeightAtStart).reduce((sum, [matId, weight]) => sum + weight * salePrice(matId), 0);
    onHandValueAtSellEnd = Object.entries(onHandWeightAtEnd).reduce((sum, [matId, weight]) => sum + weight * salePrice(matId), 0);
    realizedMarginAtSell = shipmentRevenue - purchasedDollars + (onHandValueAtSellEnd - onHandValueAtSellStart);
  }

  return {
    purchasedWeightLbs,
    purchasedDollars,
    upgradeGainLbs,
    shrinkLbs,
    shrinkPercentOfPurchased,
    unexplainedVarianceLbs,
    shipmentRevenue,
    onHandValueAtCostStart,
    onHandValueAtCostEnd,
    realizedMarginAtCost,
    onHandValueAtSellStart,
    onHandValueAtSellEnd,
    realizedMarginAtSell,
    hasSellPriceForAllMaterials
  };
}
