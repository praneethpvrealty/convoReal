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
import { rowMatchesLocality } from '@/lib/locality-match';
import { accountPropertiesShowcaseUrl } from '@/lib/showcase/account-showcase-url';

const MAX_LINKED_LISTINGS = 5;

type NearMissProperty = Pick<
  Property,
  | 'id'
  | 'title'
  | 'price'
  | 'listing_type'
  | 'property_code'
  | 'location'
  | 'sublocality'
  | 'locality_canonical'
  | 'project'
>;

export interface AreaNearMiss {
  area: string;
  properties: NearMissProperty[];
  minPrice: number;
  maxPrice: number;
}

export interface NearMissBrief {
  areas: string[];
  listingTypes: string[];
  budgetMin: number | null;
  budgetMax: number | null;
}

/**
 * Live listings in the first of the lead's areas that has any, whatever
 * their price or type, cheapest first. Only the deal type is kept: a
 * buyer is never offered a rental as "in your area".
 */
export function findAreaNearMiss(
  rows: NearMissProperty[],
  brief: Pick<NearMissBrief, 'areas' | 'listingTypes'>
): AreaNearMiss | null {
  const wantsOneDeal = brief.listingTypes.length === 1;
  for (const area of brief.areas) {
    const label = area.trim();
    if (!label) continue;
    const properties = rows
      .filter((row) => Number(row.price) > 0)
      .filter(
        (row) =>
          !wantsOneDeal ||
          !row.listing_type ||
          row.listing_type === brief.listingTypes[0]
      )
      .filter((row) => rowMatchesLocality(row, label))
      .sort((a, b) => Number(a.price) - Number(b.price));
    if (properties.length > 0) {
      return {
        area: label,
        properties,
        minPrice: Number(properties[0].price),
        maxPrice: Number(properties[properties.length - 1].price),
      };
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

function budgetRelation(
  nearMiss: AreaNearMiss,
  brief: Pick<NearMissBrief, 'budgetMin' | 'budgetMax'>
): string {
  if (brief.budgetMax != null && nearMiss.minPrice > brief.budgetMax)
    return ' — above your budget';
  if (brief.budgetMin != null && nearMiss.maxPrice < brief.budgetMin)
    return ' — below your budget';
  return '';
}

export function buildAreaNearMissLine(
  nearMiss: AreaNearMiss,
  brief: Pick<NearMissBrief, 'budgetMin' | 'budgetMax'>,
  url: string
): string {
  const count = nearMiss.properties.length;
  const price =
    nearMiss.minPrice === nearMiss.maxPrice
      ? `at ${inr(nearMiss.minPrice)}`
      : `at ${inr(nearMiss.minPrice)}–${inr(nearMiss.maxPrice)}`;
  const what =
    count === 1
      ? `1 listing in ${nearMiss.area}`
      : `${count} listings in ${nearMiss.area}`;
  return `📍 We do have ${what}, ${price}${budgetRelation(nearMiss, brief)}. Take a look: ${url}`;
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
    const { data } = await args.db
      .from('properties')
      .select(
        'id, title, price, listing_type, property_code, location, sublocality, locality_canonical, project'
      )
      .eq('account_id', args.accountId)
      .eq('is_published', true)
      .eq('status', 'Available');
    const nearMiss = findAreaNearMiss(
      (data || []) as NearMissProperty[],
      args.brief
    );
    if (!nearMiss) return null;
    const url = await accountPropertiesShowcaseUrl(
      args.db,
      args.accountId,
      nearMiss.properties.slice(0, MAX_LINKED_LISTINGS),
      args.contactId
    );
    return buildAreaNearMissLine(nearMiss, args.brief, url);
  } catch (err) {
    console.error('[area-near-miss] failed:', err);
    return null;
  }
}
