import { canonicalCity, normalizeToken } from './city';

export const MIN_MARKET_COMPARABLES = 5;
export const MARKET_LOOKBACK_MONTHS = 6;

export interface MarketRateCell {
  period_month: string;
  city: string;
  locality: string;
  property_type: string;
  priced_count: number | null;
  median_price_per_sqft: number | null;
  p25_price_per_sqft: number | null;
  p75_price_per_sqft: number | null;
}

export interface MarketRange {
  low: number;
  mid: number;
  high: number;
  rate_per_sqft: number;
  comparables: number;
  period_month: string;
}

export interface MarketPlacement {
  city: string;
  locality: string;
  property_type: string;
}

export function marketPlacement(property: {
  city?: string | null;
  sublocality?: string | null;
  locality_canonical?: string | null;
  type?: string | null;
}): MarketPlacement | null {
  const city = canonicalCity(property.city);
  const locality =
    normalizeToken(property.locality_canonical) ??
    normalizeToken(property.sublocality);
  const property_type = normalizeToken(property.type);
  if (!city || !locality || !property_type) return null;
  return { city, locality, property_type };
}

export function placementKey(p: MarketPlacement): string {
  return `${p.city}|${p.locality}|${p.property_type}`;
}

export function marketLookbackStart(now: Date = new Date()): string {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (MARKET_LOOKBACK_MONTHS - 1),
      1
    )
  )
    .toISOString()
    .slice(0, 10);
}

function positive(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export function marketRange(
  areaSqft: number | null | undefined,
  cells: MarketRateCell[]
): MarketRange | null {
  const area = positive(areaSqft);
  if (!area) return null;
  const usable = cells
    .map((cell) => ({
      cell,
      comparables: positive(cell.priced_count) ?? 0,
      median: positive(cell.median_price_per_sqft),
    }))
    .filter((c) => c.median !== null && c.comparables >= MIN_MARKET_COMPARABLES)
    .sort((a, b) => b.cell.period_month.localeCompare(a.cell.period_month));
  const best = usable[0];
  if (!best || best.median === null) return null;
  const low = positive(best.cell.p25_price_per_sqft) ?? best.median;
  const high = positive(best.cell.p75_price_per_sqft) ?? best.median;
  return {
    low: Math.round(area * Math.min(low, best.median)),
    mid: Math.round(area * best.median),
    high: Math.round(area * Math.max(high, best.median)),
    rate_per_sqft: Math.round(best.median),
    comparables: best.comparables,
    period_month: best.cell.period_month,
  };
}
