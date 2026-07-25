import type { Property } from '@/types';

const TRAILING_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function propertySlug(
  property: Pick<Property, 'id' | 'title' | 'sublocality' | 'city'>
): string {
  const words = [property.title, property.sublocality || property.city]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return words ? `${words}-${property.id}` : property.id;
}

// Slugs end in the listing UUID so resolution never depends on the
// human-readable prefix (which changes when the title is edited). A slug
// with no UUID is treated as a bare property_code/UUID lookup key.
export function propertyLookupKeyFromSlug(slug: string): string {
  const decoded = decodeURIComponent(slug);
  const match = decoded.match(TRAILING_UUID_RE);
  return match ? match[0].toLowerCase() : decoded;
}
