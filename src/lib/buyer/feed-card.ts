import type { Property } from '@/types';
import { storagePublicUrl } from '@/lib/storage/url';
import {
  isLocationGuarded,
  localityLabel,
} from '@/lib/inventory/location-guard';

/**
 * The listing as a buyer-portal card carries it. Columns selected only
 * so the matcher can score them never reach the buyer: with the project
 * name, a tower and a floor number identify the exact unit, which is
 * what the location guard exists to keep back.
 */
export function buyerCardProperty(property: Property) {
  return {
    ...property,
    location: isLocationGuarded(property)
      ? localityLabel(property)
      : property.location,
    location_privacy: undefined,
    notes: undefined,
    tags: undefined,
    floor_tenancies: undefined,
    tower: undefined,
    floor_number: undefined,
    images: Array.isArray(property.images)
      ? property.images.map(storagePublicUrl)
      : property.images,
  };
}
