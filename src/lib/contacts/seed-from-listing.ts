// The requirement a listing implies, for a contact who has none.
//
// A lead who taps "Update my preferences" under a status notice is
// matched against the requirement on their contact record. A portal
// lead has one from the day they arrived — the email webhook files the
// listing's price as the budget anchor, its locality and its type. A
// lead filed any other way (an agent's enquiry card, a journey import,
// a merge) can hold nothing at all, and the matcher then has nothing
// to rank against: the tap says "nothing fits" to a lead whose enquiry
// named a plot, a size, a locality and a price in one line.
//
// So the notice's own listing seeds the record, the way the portal path
// does, and only when the record is empty: a stated preference, however
// old, is never overwritten by an inference.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { PROPERTY_TYPE_OPTIONS } from '@/lib/match-feedback';
import { toSquareFeet } from '@/lib/area-units';
import { areaLabelFromListing } from '@/app/api/leads/email-webhook/email-parser';
import { activeRequirementProfiles } from '@/lib/requirements/profiles';

/** The band around the listing's own size that still reads as "a plot
 *  like it": the larger corner sites in the same layout qualify, a
 *  60x40 beside a 4,000 sq.ft enquiry does not. */
const SIZE_BAND_BELOW = 0.75;
const SIZE_BAND_ABOVE = 1.5;

/** The listing fields the seed reads, as a raw row or a Property. */
export interface ListingSeedSource {
  type?: string | null;
  listing_type?: string | null;
  price?: number | string | null;
  land_area?: number | string | null;
  land_area_unit?: string | null;
  location?: string | null;
  sublocality?: string | null;
}

export type RequirementSeed = Pick<
  Contact,
  | 'pref_property_types'
  | 'pref_property_categories'
  | 'pref_listing_types'
  | 'pref_areas'
  | 'pref_budget_max'
  | 'pref_budget_anchor'
  | 'pref_land_area_min_sqft'
  | 'pref_land_area_max_sqft'
  | 'pref_extracted_at'
>;

const hasAny = (list: unknown[] | null | undefined) =>
  Array.isArray(list) && list.length > 0;
const hasNumber = (value: unknown) => value != null && Number(value) > 0;

/** True when anything on the record already says what the contact
 *  wants: a type, a buy-or-rent intent, an area, a budget (or an
 *  explicit "no budget"), a size, a BHK count, a requirement line or an
 *  active requirement profile. A profile-only contact is matched from
 *  the profile, and legacy columns seeded beside it would rank as a
 *  second brief. */
export function hasSavedRequirement(contact: Contact): boolean {
  return (
    activeRequirementProfiles(contact).length > 0 ||
    hasAny(contact.pref_property_types) ||
    hasAny(contact.pref_listing_types) ||
    hasNumber(contact.pref_bhk_min) ||
    hasNumber(contact.pref_bhk_max) ||
    hasAny(contact.pref_property_categories) ||
    hasAny(contact.property_interests) ||
    hasAny(contact.pref_areas) ||
    hasAny(contact.areas_of_interest) ||
    hasAny(contact.pref_projects) ||
    hasAny(contact.projects_of_interest) ||
    hasNumber(contact.pref_budget_min) ||
    hasNumber(contact.pref_budget_max) ||
    hasNumber(contact.min_budget) ||
    hasNumber(contact.max_budget) ||
    hasNumber(contact.pref_land_area_min_sqft) ||
    hasNumber(contact.pref_land_area_max_sqft) ||
    contact.no_budget === true ||
    !!(contact.requirements || '').trim()
  );
}

/**
 * The seed a listing implies, or null when the listing says nothing
 * usable (no type, no area, no price, no size).
 */
export function requirementSeedFromListing(
  property: ListingSeedSource,
  now = new Date()
): RequirementSeed | null {
  const seed: RequirementSeed = { pref_extracted_at: now.toISOString() };
  let seeded = false;

  const type = property.type?.trim();
  if (type) {
    const option = PROPERTY_TYPE_OPTIONS.find((o) => o.types.includes(type));
    seed.pref_property_types = option ? [...option.types] : [type];
    if (option?.categories?.length)
      seed.pref_property_categories = [...option.categories];
    seeded = true;
  }

  if (property.listing_type === 'Sale' || property.listing_type === 'Rent') {
    seed.pref_listing_types = [property.listing_type];
  }

  const area = areaLabelFromListing(property);
  if (area) {
    seed.pref_areas = [area];
    seeded = true;
  }

  const price = Number(property.price) || 0;
  if (price > 0) {
    seed.pref_budget_max = price;
    seed.pref_budget_anchor = price;
    seeded = true;
  }

  const sqft = toSquareFeet(
    property.land_area != null ? Number(property.land_area) : null,
    property.land_area_unit
  );
  if (sqft && sqft > 0) {
    seed.pref_land_area_min_sqft = Math.round(sqft * SIZE_BAND_BELOW);
    seed.pref_land_area_max_sqft = Math.round(sqft * SIZE_BAND_ABOVE);
    seeded = true;
  }

  return seeded ? seed : null;
}

/**
 * Writes the listing's seed onto a contact that has no requirement.
 * Returns the seed written, or null when nothing was written — the
 * record already held a requirement, the listing implied none, or the
 * write failed (logged; the caller ranks against what is there).
 */
export async function seedRequirementFromListing(args: {
  db: SupabaseClient;
  accountId: string;
  contact: Contact;
  property: ListingSeedSource;
}): Promise<RequirementSeed | null> {
  const { db, accountId, contact, property } = args;
  if (hasSavedRequirement(contact)) return null;
  const seed = requirementSeedFromListing(property);
  if (!seed) return null;

  const { error } = await db
    .from('contacts')
    .update(seed)
    .eq('id', contact.id)
    .eq('account_id', accountId);
  if (error) {
    console.error('[seed-from-listing] contact update failed:', error);
    return null;
  }
  return seed;
}
