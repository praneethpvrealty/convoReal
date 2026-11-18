export const PROPERTY_CHANGED_CODE = 'PROPERTY_CHANGED';

/** What the mobile editor loads and sends back. */
export const PROPERTY_EDIT_CORE_FIELDS = [
  'title',
  'description',
  'price',
  'rent_per_month',
  'maintenance',
  'status',
  'listing_type',
  'sold_price',
  'bedrooms',
  'bathrooms',
  'area_sqft',
  'area_unit',
  'super_built_area',
  'total_floors',
  'land_area',
  'land_area_unit',
  'dimensions',
  'road_width',
  'road_width_unit',
  'facing_direction',
  'year_built',
  'type',
  'images',
  'location',
  'sublocality',
  'city',
  'state',
  'google_map_link',
  'is_published',
  'showcase_visibility',
  'showcase_audience',
  'features',
  'nearby_highlights',
  'tags',
  'khata_epid',
  'khata_form',
  'floor_tenancies',
  'floor_plans',
  'owner_contact_id',
] as const;

/** Everything the web form sends back: the core plus its extra sections. */
export const PROPERTY_EDIT_VERSION_FIELDS = [
  ...PROPERTY_EDIT_CORE_FIELDS,
  'advance',
  'gst',
  'jv_structure',
  'owner_share_percent',
  'builder_share_percent',
  'goodwill_amount',
  'bts_lease_years',
  'bts_lock_in_years',
  'bts_escalation_percent',
  'seller_final_price',
  'seller_final_price_per_sqft',
  'furnishing',
  'possession_date',
  'floor_number',
  'balconies',
  'flooring',
  'power_backup',
  'project',
  'land_zone',
  'ideal_for',
  'ownership_status',
  'land_use_zoning',
  'legal_status',
  'conversion_type',
  'deal_remarks',
  'documents',
  'listing_source',
  'location_privacy',
  'rental_income',
  'notes',
] as const;

export const PROPERTY_EDIT_VERSION_SELECT =
  'title, description, price, rent_per_month, maintenance, status, listing_type, sold_price, bedrooms, bathrooms, area_sqft, area_unit, super_built_area, total_floors, land_area, land_area_unit, dimensions, road_width, road_width_unit, facing_direction, year_built, type, images, location, sublocality, city, state, google_map_link, is_published, showcase_visibility, showcase_audience, features, nearby_highlights, tags, khata_epid, khata_form, floor_tenancies, floor_plans, owner_contact_id, advance, gst, jv_structure, owner_share_percent, builder_share_percent, goodwill_amount, bts_lease_years, bts_lock_in_years, bts_escalation_percent, seller_final_price, seller_final_price_per_sqft, furnishing, possession_date, floor_number, balconies, flooring, power_backup, project, land_zone, ideal_for, ownership_status, land_use_zoning, legal_status, conversion_type, deal_remarks, documents, listing_source, location_privacy, rental_income, notes' as const;

function canonical(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonical(source[key]);
    }
    return sorted;
  }
  return value;
}

function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = (Math.imul(b, 33) + code) | 0;
  }
  return (
    (a >>> 0).toString(16).padStart(8, '0') +
    (b >>> 0).toString(16).padStart(8, '0')
  );
}

function fingerprint(
  row: Record<string, unknown>,
  fields: readonly string[],
  tag: string
): string | null {
  const picked: unknown[] = [];
  for (const field of fields) {
    if (row[field] === undefined) return null;
    picked.push(canonical(row[field]));
  }
  return tag + hash(JSON.stringify(picked));
}

/**
 * Every version a row can be opened under: the full one when it carries
 * all the columns the web form writes, and the core one the mobile editor
 * can compute from its narrower read. A save is checked against whichever
 * the client sent, so each surface is held to the columns it overwrites.
 */
export function propertyEditVersions(
  row: Record<string, unknown> | null | undefined
): string[] {
  if (!row) return [];
  return [
    fingerprint(row, PROPERTY_EDIT_VERSION_FIELDS, 'f'),
    fingerprint(row, PROPERTY_EDIT_CORE_FIELDS, 'c'),
  ].filter((version): version is string => version !== null);
}

/**
 * A fingerprint of the fields an agent edits on a listing, taken from the
 * row a form was opened with and compared with the row a save is about to
 * replace. It deliberately leaves out updated_at and everything background
 * work writes (catalog sync, video and YouTube status, coordinates), so a
 * job touching the row does not read as someone else's edit. Returns the
 * widest version the row supports, and null when it lacks even the core
 * fields, so a caller holding a narrower projection sends no version
 * rather than one that can never match.
 */
export function propertyEditVersion(
  row: Record<string, unknown> | null | undefined
): string | null {
  return propertyEditVersions(row)[0] ?? null;
}
