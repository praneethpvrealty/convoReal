// ============================================================
// Area near-misses — "nothing fits" is not the whole truth when the
// lead's own locality has live stock at another price.
//
// A plot buyer at ₹30–35 L in Suryanagar was told nothing fits while
// two Suryanagar listings sat in inventory at ₹2.4 Cr and ₹6 Cr. The
// agent would have said so; the bot now says so too, with the price
// band, so the lead can decide whether to stretch rather than wait.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Property } from '@/types';
import {
  LISTING_TYPES,
  NICHE_LISTING_TYPES,
  RENT_PRICED_LISTING_TYPES,
  listingBudgetValue,
  resolveListingType,
  type ListingType,
} from '@/lib/matching';
import { localityRowPrefilter, rowMatchesLocality } from '@/lib/locality-match';
import { accountPropertiesShowcaseUrl } from '@/lib/showcase/account-showcase-url';

const MAX_LINKED_LISTINGS = 5;
export const NEAR_MISS_SCAN_LIMIT = 200;
export const MAX_NEAR_MISS_AREAS = 3;
export const MAX_NEAR_MISS_SCANS = 6;

type NearMissProperty = Pick<
  Property,
  | 'id'
  | 'title'
  | 'price'
  | 'rent_per_month'
  | 'listing_type'
  | 'property_code'
  | 'location'
  | 'sublocality'
  | 'locality_canonical'
  | 'project'
>;

export interface AreaNearMiss {
  area: string;
  listingType: ListingType;
  properties: NearMissProperty[];
  minPrice: number;
  maxPrice: number;
  truncated: boolean;
}

export interface NearMissBrief {
  areas: string[];
  listingTypes: string[];
  budgetMin: number | null;
  budgetMax: number | null;
}

export function nearMissListingTypes(listingTypes: string[]): ListingType[] {
  const stated = LISTING_TYPES.filter((type) => listingTypes.includes(type));
  return stated.length > 0
    ? stated
    : LISTING_TYPES.filter((type) => !NICHE_LISTING_TYPES.includes(type));
}

const isRentPriced = (type: ListingType) =>
  RENT_PRICED_LISTING_TYPES.includes(type);

/**
 * Live listings in the first of the lead's areas that has any, whatever
 * their price or property type, cheapest first, all of one deal type the
 * lead would be matched against, priced the way the engine prices it.
 */
export function findAreaNearMiss(
  rows: NearMissProperty[],
  brief: Pick<NearMissBrief, 'areas' | 'listingTypes'>,
  truncated = false
): AreaNearMiss | null {
  const types = nearMissListingTypes(brief.listingTypes);
  for (const area of brief.areas) {
    const label = area.trim();
    if (!label) continue;
    for (const listingType of types) {
      const properties = rows
        .filter((row) => resolveListingType(row) === listingType)
        .filter((row) => listingBudgetValue(row) > 0)
        .filter((row) => rowMatchesLocality(row, label))
        .sort((a, b) => listingBudgetValue(a) - listingBudgetValue(b));
      if (properties.length > 0) {
        return {
          area: label,
          listingType,
          properties,
          minPrice: listingBudgetValue(properties[0]),
          maxPrice: listingBudgetValue(properties[properties.length - 1]),
          truncated,
        };
      }
    }
  }
  return null;
}

function inr(n: number): string {
  return n >= 10_000_000
    ? `₹${(n / 10_000_000).toFixed(2).replace(/\.?0+$/, '')} Cr`
    : n >= 100_000
      ? `₹${(n / 100_000).toFixed(2).replace(/\.?0+$/, '')} L`
      : `₹${n.toLocaleString('en-IN')}`;
}

type BudgetBrief = Pick<
  NearMissBrief,
  'budgetMin' | 'budgetMax' | 'listingTypes'
>;

function applicableBudget(
  nearMiss: AreaNearMiss,
  brief: BudgetBrief
): { min: number | null; max: number | null } | null {
  if (brief.budgetMin == null && brief.budgetMax == null) return null;
  const stated = LISTING_TYPES.filter((type) =>
    brief.listingTypes.includes(type)
  );
  const budgetIsRent = stated.length > 0 && stated.every(isRentPriced);
  const budgetIsPrice = !budgetIsRent;
  const fits = isRentPriced(nearMiss.listingType)
    ? budgetIsRent
    : budgetIsPrice;
  return fits ? { min: brief.budgetMin, max: brief.budgetMax } : null;
}

function budgetRelation(nearMiss: AreaNearMiss, brief: BudgetBrief): string {
  const budget = applicableBudget(nearMiss, brief);
  if (!budget) return '';
  if (budget.max != null && nearMiss.minPrice > budget.max)
    return ' — above your budget';
  if (
    !nearMiss.truncated &&
    budget.min != null &&
    nearMiss.maxPrice < budget.min
  )
    return ' — below your budget';
  return '';
}

export function nearMissLinkedListings(
  nearMiss: AreaNearMiss,
  brief: BudgetBrief
): NearMissProperty[] {
  const budget = applicableBudget(nearMiss, brief);
  if (!budget) return nearMiss.properties.slice(0, MAX_LINKED_LISTINGS);
  const distance = (row: NearMissProperty) => {
    const value = listingBudgetValue(row);
    if (budget.max != null && value > budget.max) return value - budget.max;
    if (budget.min != null && value < budget.min) return budget.min - value;
    return 0;
  };
  return [...nearMiss.properties]
    .sort(
      (a, b) =>
        distance(a) - distance(b) ||
        listingBudgetValue(a) - listingBudgetValue(b)
    )
    .slice(0, MAX_LINKED_LISTINGS);
}

export function buildAreaNearMissLine(
  nearMiss: AreaNearMiss,
  brief: BudgetBrief,
  url: string
): string {
  const count = nearMiss.properties.length;
  const linked = Math.min(count, MAX_LINKED_LISTINGS);
  const perMonth = isRentPriced(nearMiss.listingType) ? ' a month' : '';
  const price = nearMiss.truncated
    ? `from ${inr(nearMiss.minPrice)}${perMonth}`
    : nearMiss.minPrice === nearMiss.maxPrice
      ? `at ${inr(nearMiss.minPrice)}${perMonth}`
      : `at ${inr(nearMiss.minPrice)}–${inr(nearMiss.maxPrice)}${perMonth}`;
  const what = nearMiss.truncated
    ? `${count}+ listings in ${nearMiss.area}`
    : count === 1
      ? `1 listing in ${nearMiss.area}`
      : `${count} listings in ${nearMiss.area}`;
  const link =
    linked === count && !nearMiss.truncated
      ? `Take a look: ${url}`
      : applicableBudget(nearMiss, brief)
        ? `Here are the ${linked} closest to your budget: ${url}`
        : `Here are the ${linked} most affordable: ${url}`;
  return `📍 We do have ${what}, ${price}${budgetRelation(nearMiss, brief)}. ${link}`;
}

async function fetchAreaCandidates(
  db: SupabaseClient,
  accountId: string,
  area: string,
  listingType: ListingType,
  from?: { value: number; ascending: boolean }
): Promise<NearMissProperty[]> {
  const prefilter = localityRowPrefilter(area);
  if (!prefilter) return [];
  const valueColumn = isRentPriced(listingType) ? 'rent_per_month' : 'price';
  let query = db
    .from('properties')
    .select(
      'id, title, price, rent_per_month, listing_type, property_code, location, sublocality, locality_canonical, project'
    )
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .or(prefilter)
    .gt(valueColumn, 0);
  query =
    listingType === 'Sale'
      ? query.or(
          `listing_type.is.null,listing_type.not.in.(${LISTING_TYPES.filter(
            (type) => type !== 'Sale'
          )
            .map((type) => `"${type}"`)
            .join(',')})`
        )
      : query.eq('listing_type', listingType);
  if (from)
    query = from.ascending
      ? query.gte(valueColumn, from.value)
      : query.lt(valueColumn, from.value);
  const { data, error } = await query
    .order(valueColumn, { ascending: from?.ascending ?? true })
    .limit(NEAR_MISS_SCAN_LIMIT);
  if (error) throw error;
  return (data || []) as NearMissProperty[];
}

async function linkedListings(
  db: SupabaseClient,
  accountId: string,
  nearMiss: AreaNearMiss,
  brief: BudgetBrief
): Promise<NearMissProperty[]> {
  const budget = applicableBudget(nearMiss, brief);
  if (!nearMiss.truncated || !budget)
    return nearMissLinkedListings(nearMiss, brief);
  const pivot = budget.min ?? budget.max!;
  const around = await Promise.all(
    [true, false].map((ascending) =>
      fetchAreaCandidates(db, accountId, nearMiss.area, nearMiss.listingType, {
        value: pivot,
        ascending,
      })
    )
  );
  const closest = findAreaNearMiss(around.flat(), {
    areas: [nearMiss.area],
    listingTypes: [nearMiss.listingType],
  });
  return nearMissLinkedListings(closest ?? nearMiss, brief);
}

/** The near-miss line for this lead, or null when their areas hold no
 *  live stock at all. Best-effort: a failure costs the line, never the
 *  reply it sits in. */
export async function areaNearMissLine(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  brief: NearMissBrief;
}): Promise<string | null> {
  if (args.brief.areas.length === 0) return null;
  try {
    const areas = [
      ...new Map(
        args.brief.areas
          .map((area) => area.trim())
          .filter(Boolean)
          .map((area) => [area.toLowerCase(), area] as const)
      ).values(),
    ].slice(0, MAX_NEAR_MISS_AREAS);
    let scans = 0;
    for (const area of areas) {
      for (const listingType of nearMissListingTypes(args.brief.listingTypes)) {
        if (scans >= MAX_NEAR_MISS_SCANS) return null;
        scans += 1;
        const rows = await fetchAreaCandidates(
          args.db,
          args.accountId,
          area,
          listingType
        );
        const nearMiss = findAreaNearMiss(
          rows,
          { areas: [area], listingTypes: [listingType] },
          rows.length >= NEAR_MISS_SCAN_LIMIT
        );
        if (!nearMiss) continue;
        const url = await accountPropertiesShowcaseUrl(
          args.db,
          args.accountId,
          await linkedListings(args.db, args.accountId, nearMiss, args.brief),
          args.contactId
        );
        return buildAreaNearMissLine(nearMiss, args.brief, url);
      }
    }
    return null;
  } catch (err) {
    console.error('[area-near-miss] failed:', err);
    return null;
  }
}
