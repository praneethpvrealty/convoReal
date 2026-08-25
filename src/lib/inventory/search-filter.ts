import type { Property } from '@/types';
import { parsePropertyQuery } from '@/lib/search-parser';

export function filterPropertiesBySearch<T extends Partial<Property>>(
  properties: T[],
  searchQuery: string
): T[] {
  if (!searchQuery.trim()) return properties;

  const parsed = parsePropertyQuery(searchQuery);
  let result = properties;

  if (parsed.minPrice !== null) {
    result = result.filter((p) => (p.price ?? 0) >= parsed.minPrice!);
  }
  if (parsed.maxPrice !== null) {
    result = result.filter((p) => (p.price ?? 0) <= parsed.maxPrice!);
  }
  if (parsed.types.length > 0) {
    result = result.filter((p) => parsed.types.includes(p.type ?? ''));
  }
  if (parsed.rentYielding) {
    result = result.filter(
      (p) => (p.rental_income ?? 0) > 0 || (p.roi ?? 0) > 0
    );
  }
  if (parsed.listingSource) {
    result = result.filter(
      (p) => (p.listing_source ?? 'owner') === parsed.listingSource
    );
  }
  if (parsed.remainingSearch) {
    const text = parsed.remainingSearch;
    result = result.filter(
      (p) =>
        p.title?.toLowerCase().includes(text) ||
        p.location?.toLowerCase().includes(text) ||
        p.sublocality?.toLowerCase().includes(text) ||
        p.city?.toLowerCase().includes(text) ||
        p.project?.toLowerCase().includes(text) ||
        p.property_code?.toLowerCase().includes(text)
    );
  }

  return result;
}

/** The receiving half of a hand-picked share link: resolves ?ids= keys
 *  (property_code or id, case-insensitive) into listings, in link order. */
export function selectPinnedProperties<T extends Partial<Property>>(
  properties: T[],
  keys: string[]
): T[] {
  if (keys.length === 0) return properties;
  const byKey = new Map<string, T>();
  for (const p of properties) {
    if (p.id) byKey.set(p.id.toLowerCase(), p);
    if (p.property_code) byKey.set(p.property_code.toLowerCase(), p);
  }
  return keys
    .map((key) => byKey.get(key.trim().toLowerCase()))
    .filter((p): p is T => Boolean(p));
}
