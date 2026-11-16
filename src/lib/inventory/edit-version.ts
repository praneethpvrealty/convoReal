export const PROPERTY_CHANGED_CODE = 'PROPERTY_CHANGED';

export const PROPERTY_EDIT_VERSION_FIELDS = [
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
  'land_area',
  'land_area_unit',
  'type',
  'images',
  'location',
  'sublocality',
  'city',
  'is_published',
  'showcase_visibility',
  'features',
  'tags',
] as const;

export const PROPERTY_EDIT_VERSION_SELECT =
  'title, description, price, rent_per_month, maintenance, status, listing_type, sold_price, bedrooms, bathrooms, area_sqft, area_unit, land_area, land_area_unit, type, images, location, sublocality, city, is_published, showcase_visibility, features, tags' as const;

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

/**
 * A fingerprint of the fields an agent edits on a listing, taken from the
 * row a form was opened with and again from the row a save is about to
 * replace. It deliberately leaves out updated_at and everything background
 * work writes (catalog sync, video and YouTube status, coordinates), so a
 * job touching the row does not read as someone else's edit. Returns null
 * when the row does not carry every field, so a caller holding a narrower
 * projection sends no version rather than one that can never match.
 */
export function propertyEditVersion(
  row: Record<string, unknown> | null | undefined
): string | null {
  if (!row) return null;
  const picked: unknown[] = [];
  for (const field of PROPERTY_EDIT_VERSION_FIELDS) {
    if (row[field] === undefined) return null;
    picked.push(canonical(row[field]));
  }
  return hash(JSON.stringify(picked));
}
