import type { Property } from '@/types';
import { propertyMapPin } from '@/lib/maps/map-links';

export function publicMapProperties(properties: Property[]): Property[] {
  return properties.flatMap((property) => {
    if (
      property.teaser_gated ||
      property.location_revealed === false ||
      (property.location_guarded && !property.location_revealed)
    )
      return [];
    const pin = propertyMapPin(property)?.coordinates;
    return pin
      ? [{ ...property, latitude: pin.latitude, longitude: pin.longitude }]
      : [];
  });
}

export function publicMapAreas(
  properties: Property[]
): Array<{ label: string; count: number }> {
  const areas = new Map<string, { label: string; count: number }>();
  for (const property of properties) {
    const label = [property.sublocality, property.city, property.state]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', ');
    if (!label) continue;
    const key = label.toLocaleLowerCase('en-IN');
    const area = areas.get(key);
    if (area) area.count += 1;
    else areas.set(key, { label, count: 1 });
  }
  return [...areas.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );
}
