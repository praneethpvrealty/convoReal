import type { Property } from '@/types';

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function propertyLocationValues(property: Property) {
  return [property.sublocality, property.location, property.city].filter(
    (value): value is string => Boolean(value?.trim())
  );
}

const CITY_ALIASES = [['bangalore', 'bengaluru']];

function cityKeys(properties: Property[]) {
  const keys = new Set<string>();
  for (const property of properties) {
    if (property.city?.trim()) keys.add(normalized(property.city));
  }
  for (const aliases of CITY_ALIASES) {
    if (aliases.some((alias) => keys.has(alias))) {
      aliases.forEach((alias) => keys.add(alias));
    }
  }
  return keys;
}

export function locationCandidates(properties: Property[]) {
  const byKey = new Map<string, string>();

  for (const property of properties) {
    for (const value of propertyLocationValues(property)) {
      const key = normalized(value);
      if (!byKey.has(key)) byKey.set(key, value.trim().replace(/\s+/g, ' '));
    }
  }

  const cities = cityKeys(properties);
  const locations = [...byKey.entries()]
    .filter(([key]) => {
      const comma = key.lastIndexOf(',');
      if (comma < 0) return true;
      const city = key.slice(comma + 1).trim();
      const place = key.slice(0, comma).trim();
      return !(cities.has(city) && byKey.has(place));
    })
    .map(([, label]) => label);

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
