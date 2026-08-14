// ------------------------------------------------------------------
// Rental yield (ROI) — the one place that decides whether a listing
// has a yield at all.
//
// Yield is rent over CAPITAL VALUE, and `properties.price` is not
// always one: a Rent or Built to Suit listing stores the MONTHLY rent
// there, so a year of rent over a month of rent reads 1200%. A JV/JD
// deal has no asking price either. So the yield belongs to a sale and
// to nothing else.
//
// Hand-ported mirror of src/lib/inventory/rental-yield.ts — Metro
// cannot reach src/, so this is a copy and src/lib/mobile-parity.test.ts
// fails the build if the two drift.
// ------------------------------------------------------------------

/** Listing types whose `price` is a per-month figure, not a capital
 *  value. */
export const MONTHLY_PRICED_LISTING_TYPES = ['Rent', 'Built to Suit'];

/** True when the listing's price is what it costs per month rather than
 *  what it costs to buy. */
export function isMonthlyPricedListing(listingType?: string | null): boolean {
  return MONTHLY_PRICED_LISTING_TYPES.includes((listingType || '').trim());
}

/** True when a yield can be derived from this listing's price at all. A
 *  missing type is a sale — that is the schema default. */
export function yieldApplies(listingType?: string | null): boolean {
  const value = (listingType || '').trim();
  if (!value) return true;
  return value === 'Sale';
}

/**
 * Annual rental yield as a percentage, or null when the listing has
 * none — a rental, a Built to Suit, a JV/JD, or a listing missing
 * either half of the sum.
 */
export function rentalYieldPercent(
  listingType?: string | null,
  price?: number | null,
  rentalIncome?: number | null
): number | null {
  if (!yieldApplies(listingType)) return null;
  const p = Number(price);
  const r = Number(rentalIncome);
  if (!Number.isFinite(p) || !Number.isFinite(r)) return null;
  if (p <= 0 || r <= 0) return null;
  return Number((((r * 12) / p) * 100).toFixed(2));
}
