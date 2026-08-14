// ============================================================
// Rental yield (ROI) — the one place that decides whether a listing
// has a yield at all.
//
// Yield is rent over CAPITAL VALUE. It only means anything when
// `properties.price` holds a capital value, and on this schema it does
// not always:
//
//   • Rent and Built to Suit listings store the MONTHLY rent in
//     `price` (see the property form's parsedPrice and POST
//     /api/properties' isRentLike). Dividing a year of rent by a month
//     of rent gives 1200% — which is exactly what a J. P. Nagar office
//     at ₹15.5 L/month was advertising on its detail screen.
//   • A JV/JD deal has no asking price; `price` is an estimated project
//     value at best, and there is nothing to buy at it.
//
// So the yield belongs to a sale and to nothing else. Every surface
// that computes or stores one goes through here.
// ============================================================

/** Listing types whose `price` is a per-month figure, not a capital
 *  value. Kept in one list so the form, the API and the intake parser
 *  cannot disagree about which ones they are. */
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
