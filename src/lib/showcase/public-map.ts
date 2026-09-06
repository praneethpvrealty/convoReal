import type { Property } from '@/types';
import { propertyMapPin } from '@/lib/maps/map-links';

export function publicMapProperties(properties: Property[]): Property[] {
  return properties.flatMap((property) => {
    if (
      property.teaser_gated ||
      (property.location_guarded && !property.location_revealed)
    )
      return [];
    const pin = propertyMapPin(property)?.coordinates;
    return pin
      ? [{ ...property, latitude: pin.latitude, longitude: pin.longitude }]
      : [];
  });
}
