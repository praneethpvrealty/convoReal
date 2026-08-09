// ============================================================
// How a project's price reads to a buyer.
//
// A project has no price of its own — it has a spread. "From ₹1.85 Cr"
// is the honest headline when the cheapest available unit is that, and
// it stops being true the moment that unit sells, which is exactly why
// none of this is stored.
//
// A premium unit needs no flag. It carries a higher price, so it sets
// the top of the range and never the floor, and its own rate next to
// the project floor is what quietly justifies the asking.
// ============================================================

import type { ProjectUnitStats } from '@/types';
import { formatShareAmount } from '@/lib/share-message-builder';

/** "₹8,200/sqft" — rates are read per rupee, not in lakhs. */
export function formatRatePerSqft(rate: number | null | undefined): string {
  const n = Number(rate);
  if (!n || !isFinite(n) || n <= 0) return '';
  return `₹${Math.round(n).toLocaleString('en-IN')}/sqft`;
}

/**
 * The price headline for a project card.
 *
 * Sold out is said plainly rather than shown as a price nobody can
 * act on, and a project whose units are all unpriced says so instead
 * of implying free.
 */
export function projectPriceHeadline(stats: ProjectUnitStats): string {
  if (stats.units > 0 && stats.available === 0) return 'Sold out';
  if (!stats.min_price) return 'Price on request';

  const from = formatShareAmount(stats.min_price);
  // One available unit, or every one priced the same: a range that
  // repeats itself reads like a mistake.
  if (!stats.max_price || stats.max_price === stats.min_price) return from;
  return `From ${from}`;
}

/** "From ₹8,200/sqft", or empty when no available unit has both a
 *  price and an area to divide by. */
export function projectRateHeadline(stats: ProjectUnitStats): string {
  const floor = stats.min_rate_per_sqft;
  const rate = formatRatePerSqft(floor);
  if (!rate || !floor) return '';
  const ceiling = stats.max_rate_per_sqft;
  return ceiling && Math.round(ceiling) !== Math.round(floor)
    ? `From ${rate}`
    : rate;
}

/** "3 BHK" or "2–4 BHK", from what is actually in the project. */
export function projectBhkRange(stats: ProjectUnitStats): string {
  const min = stats.min_bedrooms;
  const max = stats.max_bedrooms;
  if (!min && !max) return '';
  if (!min || !max || min === max) return `${min || max} BHK`;
  return `${min}–${max} BHK`;
}

/** "12 units · 3 sold" — the availability line under the headline. */
export function projectAvailabilityLine(stats: ProjectUnitStats): string {
  if (stats.units === 0) return 'No units added yet';
  const parts = [`${stats.units} unit${stats.units === 1 ? '' : 's'}`];
  if (stats.sold_or_contract > 0) parts.push(`${stats.sold_or_contract} sold`);
  return parts.join(' · ');
}

/**
 * Where one unit sits against its project.
 *
 * Positive means it asks more per sqft than the project's floor —
 * which is what "premium" means here, rather than a label somebody
 * remembered to tick. Null when either side cannot be computed.
 */
export function unitPremiumPercent(
  unitRatePerSqft: number | null | undefined,
  stats: ProjectUnitStats,
): number | null {
  const rate = Number(unitRatePerSqft);
  const floor = Number(stats.min_rate_per_sqft);
  if (!rate || !floor || !isFinite(rate) || !isFinite(floor) || floor <= 0) {
    return null;
  }
  return Math.round(((rate - floor) / floor) * 100);
}

/** A unit's own rate, for the card that sits inside a project. */
export function unitRatePerSqft(
  price: number | null | undefined,
  areaSqft: number | null | undefined,
): number | null {
  const p = Number(price);
  const a = Number(areaSqft);
  if (!p || !a || p <= 0 || a <= 0) return null;
  return p / a;
}

/**
 * The same figures as the project_unit_stats RPC, computed from rows
 * already in hand.
 *
 * The RPC aggregates in SQL across a whole account and guards on
 * membership, so it cannot serve an anonymous visitor — and the public
 * project page has already fetched exactly the rows it needs. This
 * gives both surfaces one arithmetic rather than two that drift.
 *
 * Note what the public page will therefore never show: the showcase
 * fetches only published, Available listings, so `sold_or_contract`
 * comes back zero there. That is correct — a catalog of what is for
 * sale is not the place to advertise what is not.
 */
export function unitStatsFromProperties(
  projectId: string,
  units: Array<{
    price?: number | null;
    area_sqft?: number | null;
    bedrooms?: number | null;
    status?: string | null;
  }>,
): ProjectUnitStats {
  const available = units.filter((u) => u.status === 'Available');
  const priced = available
    .map((u) => Number(u.price))
    .filter((n) => n > 0 && isFinite(n));
  const rates = available
    .map((u) => unitRatePerSqft(u.price, u.area_sqft))
    .filter((n): n is number => n !== null);
  const beds = units
    .map((u) => Number(u.bedrooms))
    .filter((n) => n > 0 && isFinite(n));

  return {
    project_id: projectId,
    units: units.length,
    available: available.length,
    sold_or_contract: units.filter(
      (u) => u.status === 'Sold' || u.status === 'Under Contract',
    ).length,
    min_price: priced.length ? Math.min(...priced) : null,
    max_price: priced.length ? Math.max(...priced) : null,
    min_rate_per_sqft: rates.length ? Math.min(...rates) : null,
    max_rate_per_sqft: rates.length ? Math.max(...rates) : null,
    min_bedrooms: beds.length ? Math.min(...beds) : null,
    max_bedrooms: beds.length ? Math.max(...beds) : null,
  };
}
