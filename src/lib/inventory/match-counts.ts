import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property } from '@/types';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { getMatchingContacts } from '@/lib/matching';
import {
  maskPropertyForViewer,
  type LocationViewer,
} from '@/lib/inventory/location-guard';

export const MATCH_COUNT_MAX_IDS = 100;

export const MATCH_BUYER_COLUMNS =
  'id, classification, requirements, requirement_profiles, requirement_active, min_budget, max_budget, no_budget, min_roi, requires_tenanted, property_interests, areas_of_interest, areas_of_interest_geo, projects_of_interest, strict_project_match, strict_area_match, pref_property_types, pref_property_categories, pref_bhk_min, pref_bhk_max, pref_budget_min, pref_budget_max, pref_budget_anchor, pref_land_area_min_sqft, pref_land_area_max_sqft, pref_areas, pref_excluded_areas, pref_projects, pref_min_roi, pref_requires_tenanted, pref_facing, pref_towers, pref_floor_min, pref_floor_max, pref_listing_types, pref_extracted_at, contact_notes(note_text)';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMatchCountIds(raw: string | null): string[] | null {
  const ids = [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
  if (ids.length > MATCH_COUNT_MAX_IDS) return null;
  if (ids.some((id) => !UUID.test(id))) return null;
  return ids;
}

export function countMatches(
  properties: Partial<Property>[],
  buyers: Contact[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const property of properties) {
    if (!property.id) continue;
    counts[property.id] = getMatchingContacts(property, buyers).length;
  }
  return counts;
}

export async function loadMatchCounts(
  db: SupabaseClient,
  accountId: string,
  propertyIds: string[],
  viewer: LocationViewer
): Promise<Record<string, number>> {
  if (propertyIds.length === 0) return {};
  const [propertiesResult, buyersResult] = await Promise.all([
    db
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .in('id', propertyIds),
    db
      .from('contacts')
      .select(MATCH_BUYER_COLUMNS)
      .eq('account_id', accountId)
      .eq('classification', 'Buyer'),
  ]);
  if (propertiesResult.error) throw propertiesResult.error;
  if (buyersResult.error) throw buyersResult.error;
  const properties = ((propertiesResult.data ?? []) as Property[]).map((row) =>
    maskPropertyForViewer(row, viewer)
  );
  if (properties.length === 0) return {};
  const buyers = await attachInquiredListingTypes(
    db,
    accountId,
    (buyersResult.data ?? []) as unknown as Contact[]
  );
  if (buyers.length === 0) return {};
  return countMatches(properties, buyers);
}
