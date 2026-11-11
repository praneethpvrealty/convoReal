import type { MarketRange } from '../market/valuation';

export type ValueSource = 'declared' | 'asking' | 'market' | 'guidance';

export const VALUE_SOURCE_LABELS: Record<ValueSource, string> = {
  declared: 'Your value',
  asking: 'Your expected price',
  market: 'Market range',
  guidance: 'Guidance value',
};

export const MAX_DECLARED_VALUE = 1_000_000_000_000;

export interface PropertyValue {
  property_id: string;
  title: string | null;
  agency_name: string | null;
  listing_type: string | null;
  declared: number | null;
  asking: number | null;
  guidance: { total: number; saved_at: string | null } | null;
  market: MarketRange | null;
  estimate: number | null;
  estimate_source: ValueSource | null;
}

export interface PortfolioValueTotals {
  properties: number;
  valued: number;
  estimate: number;
  guidance: number;
  guidance_count: number;
  market_low: number;
  market_high: number;
  market_count: number;
}

export interface PortfolioValue {
  properties: PropertyValue[];
  totals: PortfolioValueTotals;
  truncated: boolean;
}

export function isStillOwned(
  status: string | null | undefined,
  listingType: string | null | undefined
): boolean {
  if ((status ?? '').trim() !== 'Sold') return true;
  return listingType === 'Rent' || listingType === 'Built to Suit';
}

export function missingValueMessage(truncated: boolean): string {
  return truncated
    ? 'This property is older than the most recent ones counted in your portfolio value.'
    : 'A sold property is no longer counted in your portfolio value.';
}

export function parseDeclaredValue(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  if (raw <= 0 || raw > MAX_DECLARED_VALUE) return undefined;
  return Math.round(raw);
}

export function buildPropertyValue(input: {
  property_id: string;
  title: string | null;
  agency_name: string | null;
  listing_type: string | null;
  price: number | null;
  declared: number | null;
  guidance: { total: number; saved_at: string | null } | null;
  market: MarketRange | null;
}): PropertyValue {
  const isLet =
    input.listing_type === 'Rent' || input.listing_type === 'Built to Suit';
  const asking = !isLet && input.price && input.price > 0 ? input.price : null;
  const candidates: Array<[ValueSource, number | null]> = [
    ['declared', input.declared],
    ['asking', asking],
    ['market', input.market?.mid ?? null],
    ['guidance', input.guidance?.total ?? null],
  ];
  const chosen = candidates.find(([, amount]) => amount !== null && amount > 0);
  return {
    property_id: input.property_id,
    title: input.title,
    agency_name: input.agency_name,
    listing_type: input.listing_type,
    declared: input.declared,
    asking,
    guidance: input.guidance,
    market: input.market,
    estimate: chosen ? chosen[1] : null,
    estimate_source: chosen ? chosen[0] : null,
  };
}

export function portfolioTotals(values: PropertyValue[]): PortfolioValueTotals {
  const totals: PortfolioValueTotals = {
    properties: values.length,
    valued: 0,
    estimate: 0,
    guidance: 0,
    guidance_count: 0,
    market_low: 0,
    market_high: 0,
    market_count: 0,
  };
  for (const value of values) {
    if (value.estimate !== null) {
      totals.valued++;
      totals.estimate += value.estimate;
    }
    if (value.guidance) {
      totals.guidance_count++;
      totals.guidance += value.guidance.total;
    }
    if (value.market) {
      totals.market_count++;
      totals.market_low += value.market.low;
      totals.market_high += value.market.high;
    }
  }
  return totals;
}

export function valuedSummary(
  totals: PortfolioValueTotals,
  truncated = false
): string {
  if (totals.properties === 0) return 'No properties yet';
  if (truncated)
    return `From ${totals.valued} of your ${totals.properties} most recent properties; older ones are not counted`;
  if (totals.valued === 0) return 'Add a value to any property to start';
  if (totals.valued === totals.properties)
    return totals.properties === 1
      ? 'From your 1 property'
      : `From all ${totals.properties} properties`;
  return `From ${totals.valued} of ${totals.properties} properties`;
}
