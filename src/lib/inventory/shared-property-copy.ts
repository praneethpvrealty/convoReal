const SHARED_PROPERTY_KEYS = [
  'id',
  'account_id',
  'title',
  'description',
  'price',
  'price_per_sqft',
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
  'location',
  'type',
  'bedrooms',
  'bathrooms',
  'furnishing',
  'possession_date',
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
  'land_zone',
  'ideal_for',
  'dimensions',
  'road_width',
  'road_width_unit',
  'facing_direction',
  'nearby_highlights',
  'features',
  'images',
  'video_url',
  'youtube_video_id',
  'google_map_link',
  'latitude',
  'longitude',
  'locality_place_id',
  'locality_canonical',
  'location_privacy',
  'showcase_visibility',
  'rental_income',
  'roi',
  'is_published',
] as const;

export const SHARED_PROPERTY_COLUMNS = SHARED_PROPERTY_KEYS.join(', ');

interface SharedPropertyCopyOptions {
  accountId: string;
  userId: string;
  ownerContactId: string | null;
  status?: 'Available' | 'Pending Review';
}

export function buildSharedPropertyCopy(
  source: Record<string, unknown>,
  options: SharedPropertyCopyOptions
) {
  const copied: Record<string, unknown> = {};
  for (const key of SHARED_PROPERTY_KEYS) {
    if (key !== 'id' && key !== 'account_id' && key !== 'is_published') {
      copied[key] = source[key];
    }
  }

  return {
    ...copied,
    account_id: options.accountId,
    user_id: options.userId,
    status: options.status ?? 'Available',
    is_published: false,
    listing_source: 'agent',
    owner_contact_id: options.ownerContactId,
    source_property_id: source.id,
  };
}
