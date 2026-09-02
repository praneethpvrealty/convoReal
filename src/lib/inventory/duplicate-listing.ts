import type { Property } from '@/types';

/**
 * Columns a duplicate carries over. An allowlist rather than a blocklist:
 * a column added later stays out of the copy until it is listed here,
 * which is the safe direction for identity, media and engagement fields.
 */
export const DUPLICATE_CARRIED_FIELDS = [
  'description',
  'price',
  'price_per_sqft',
  'location',
  'type',
  'listing_type',
  'rent_per_month',
  'maintenance',
  'advance',
  'gst',
  'jv_structure',
  'owner_share_percent',
  'builder_share_percent',
  'goodwill_amount',
  'bts_lease_years',
  'bts_lock_in_years',
  'bts_escalation_percent',
  'ownership_status',
  'land_use_zoning',
  'legal_status',
  'conversion_type',
  'deal_remarks',
  'possession_date',
  'bedrooms',
  'bathrooms',
  'furnishing',
  'floor_number',
  'total_floors',
  'balconies',
  'flooring',
  'power_backup',
  'area_sqft',
  'area_unit',
  'land_area',
  'land_area_unit',
  'super_built_area',
  'sublocality',
  'city',
  'state',
  'project',
  'project_id',
  'tower',
  'latitude',
  'longitude',
  'locality_place_id',
  'locality_canonical',
  'location_privacy',
  'showcase_visibility',
  'land_zone',
  'ideal_for',
  'dimensions',
  'road_width',
  'road_width_unit',
  'facing_direction',
  'nearby_highlights',
  'features',
  'google_map_link',
  'notes',
  'tags',
  'owner_contact_id',
  'rental_income',
  'roi',
  'floor_plans',
  'listing_source',
] as const satisfies readonly (keyof Property)[];

export function duplicateListingTitle(title: string): string {
  const base = title.trim() || 'Untitled listing';
  return base.length > 195 ? `${base.slice(0, 195)} (Copy)` : `${base} (Copy)`;
}

/**
 * Row values for a copy of `source`. Photos, documents, videos, the unit
 * number and every engagement or lifecycle field are left behind: the
 * copy exists to seed the next unit in the same society, not to claim
 * the original's media or history.
 */
export function buildDuplicateListingInsert(
  source: Partial<Property> & { title: string },
  ctx: { accountId: string; userId: string | null }
): Record<string, unknown> {
  const insert: Record<string, unknown> = {
    account_id: ctx.accountId,
    user_id: ctx.userId,
    title: duplicateListingTitle(source.title),
    status: 'Available',
    is_published: false,
    images: [],
    documents: [],
  };

  for (const field of DUPLICATE_CARRIED_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    insert[field] = value;
  }

  return insert;
}
