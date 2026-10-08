import { isLandType } from './property-options';

export type LocationPrivacy = 'exact' | 'locality';

/** Stray legacy value "House" appears in imported data; over-guarding
 *  it is safer than letting it fall through. */
const GUARDED_HOUSE_TYPES = [
  'Residential House',
  'Villa',
  'Farm House',
  'House',
];

export type PrivacyFields = {
  type: string;
  location_privacy?: string | null;
};

export function isGuardedType(type: string): boolean {
  return GUARDED_HOUSE_TYPES.includes(type) || isLandType(type);
}

export function effectiveLocationPrivacy(p: PrivacyFields): LocationPrivacy {
  if (p.location_privacy === 'exact' || p.location_privacy === 'locality') {
    return p.location_privacy;
  }
  return isGuardedType(p.type) ? 'locality' : 'exact';
}

export function isLocationGuarded(p: PrivacyFields): boolean {
  return effectiveLocationPrivacy(p) === 'locality';
}

/** Locality-level substitute for the street address. */
export function localityLabel(p: {
  sublocality?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  const bits = [p.sublocality, p.city].filter(Boolean);
  if (bits.length > 0) return bits.join(', ');
  return p.state || 'Location available on request';
}
