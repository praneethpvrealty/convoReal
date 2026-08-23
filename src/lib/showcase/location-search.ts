import type { Property } from '@/types';

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function propertyLocationValues(property: Property) {
  return [property.sublocality, property.location, property.city].filter(
    (value): value is string => Boolean(value?.trim())
  );
}

export function locationCandidates(properties: Property[]) {
  const seen = new Set<string>();
  const locations: string[] = [];

  for (const property of properties) {
    for (const value of propertyLocationValues(property)) {
      const key = normalized(value);
      if (!seen.has(key)) {
        seen.add(key);
        locations.push(value.trim());
      }
    }
  }

  return locations.sort((a, b) => a.localeCompare(b));
}

export function matchesSelectedLocation(
  property: Property,
  selectedLocations: string[]
) {
  if (selectedLocations.length === 0) return true;

  const values = propertyLocationValues(property).map(normalized);
  return selectedLocations.some((selected) => {
    const location = normalized(selected);
    return values.some(
      (value) => value.includes(location) || location.includes(value)
    );
  });
}
