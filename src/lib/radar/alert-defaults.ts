export const DEFAULT_ALERT_MIN_SCORE = 80;
export const SALE_PRICE_FLOOR = 100_000;
export const UNKNOWN_LISTING_PRICE_FLOOR = 10_000;

export interface ScoredTarget {
  id: string;
  score: number | null;
}

export interface PricedListing {
  price?: number | string | null;
  listing_type?: string | null;
}

export function defaultSelectedTargetIds(
  targets: readonly ScoredTarget[]
): string[] {
  return targets
    .filter((target) => (target.score ?? 0) >= DEFAULT_ALERT_MIN_SCORE)
    .map((target) => target.id);
}

export function isImplausibleListingPrice(listing: PricedListing): boolean {
  const price = Number(listing.price);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (listing.listing_type === 'Sale') return price < SALE_PRICE_FLOOR;
  if (!listing.listing_type) return price < UNKNOWN_LISTING_PRICE_FLOOR;
  return false;
}
