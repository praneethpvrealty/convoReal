// ============================================================
// Property location guard — THE single place that decides who may
// see a property's exact location (street address, map pin,
// coordinates) and its private photos.
//
// Independent houses, villas, farm houses and land are identifiable
// on the ground from an address or a facade photo, which lets an
// agent bypass the brokerage and approach the owner directly. Those
// types are guarded by default; any property can be overridden per
// row via `properties.location_privacy` (migration 175).
//
// Every surface that serializes a property for an external viewer
// must go through `toPublicPropertyView`, and every internal API
// read through `maskPropertyForViewer` — never spread a raw row.
// Mirrors the Owners Den pattern in src/lib/den/masking.ts.
// ============================================================

import type { Property } from '@/types';
import { isLandType } from '@/lib/inventory/property-options';
import { hasMinRole, type AccountRole } from '@/lib/auth/roles';

export type LocationPrivacy = 'exact' | 'locality';

/** Stray legacy value "House" appears in imported data; over-guarding
 *  it is safer than letting it fall through. */
const GUARDED_HOUSE_TYPES = [
  'Residential House',
  'Villa',
  'Farm House',
  'House',
];

type PrivacyFields = {
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

/**
 * Everything a public (showcase / public API) viewer may receive.
 * Exact-location fields are handled separately by `toPublicPropertyView`.
 * Deliberately excluded: documents, notes, deal_remarks, owner_contact_id,
 * owner, sold_price, floor_tenancies, min_bid, deal_mode, source_property_id,
 * ownership_status, land_use_zoning, meta_catalog_error, private_images,
 * locality_place_id, locality_canonical.
 */
export const PUBLIC_PROPERTY_FIELDS = [
  'id',
  'account_id',
  'user_id',
  'title',
  'description',
  'price',
  'price_per_sqft',
  'sublocality',
  'city',
  'state',
  'type',
  'status',
  'listing_type',
  'bedrooms',
  'bathrooms',
  'area_sqft',
  'area_unit',
  'land_area',
  'land_area_unit',
  'super_built_area',
  'project',
  'land_zone',
  'ideal_for',
  'dimensions',
  'road_width',
  'road_width_unit',
  'facing_direction',
  'nearby_highlights',
  'is_published',
  'features',
  'images',
  'video_url',
  'youtube_video_id',
  'property_code',
  'rental_income',
  'roi',
  'listing_source',
  'rent_per_month',
  'maintenance',
  'advance',
  'gst',
  'jv_structure',
  'owner_share_percent',
  'builder_share_percent',
  'goodwill_amount',
  'bts_lease_years',
  'bts_lock_in_years',
  'bts_escalation_percent',
  'like_count',
  'rating_count',
  'rating_total',
  'created_at',
  'updated_at',
] as const;

/**
 * Builds the row an external viewer receives. Exact-location fields
 * (`location`, `google_map_link`, `latitude`, `longitude`) are included
 * only when the surface is allowed to reveal them AND the property is
 * not guarded; otherwise `location` carries the locality label.
 */
export function toPublicPropertyView(
  p: Property,
  opts: { revealExact: boolean }
): Property {
  const view: Record<string, unknown> = {};
  for (const key of PUBLIC_PROPERTY_FIELDS) {
    view[key] = p[key as keyof Property];
  }
  const guarded = isLocationGuarded(p);
  const reveal = opts.revealExact && !guarded;
  view.location = reveal ? p.location : localityLabel(p);
  view.google_map_link = reveal ? (p.google_map_link ?? null) : null;
  view.latitude = reveal ? (p.latitude ?? null) : null;
  view.longitude = reveal ? (p.longitude ?? null) : null;
  view.location_guarded = guarded;
  view.private_images_count = p.private_images?.length ?? 0;
  return view as unknown as Property;
}

export interface LocationViewer {
  role: AccountRole;
  userId: string | null;
}

/** Admin+ or the property's own listing agent see through the guard. */
export function canViewExactLocation(
  viewer: LocationViewer,
  p: PrivacyFields & Pick<Property, 'user_id'>
): boolean {
  if (!isLocationGuarded(p)) return true;
  if (hasMinRole(viewer.role, 'admin')) return true;
  return Boolean(viewer.userId && p.user_id === viewer.userId);
}

/**
 * Masks a row for an authenticated Engine member who may not see the
 * exact location. Identity passthrough for privileged viewers.
 */
export function maskPropertyForViewer<T extends Property>(
  p: T,
  viewer: LocationViewer
): T {
  if (canViewExactLocation(viewer, p)) return p;
  return {
    ...p,
    location: localityLabel(p),
    google_map_link: null,
    latitude: null,
    longitude: null,
    locality_place_id: null,
    locality_canonical: null,
    private_images: [],
    private_images_count: p.private_images?.length ?? 0,
    location_guarded: true,
  };
}

/** "Rahul Sharma" → "Ra••• Sh•••" — enough to recognise, not to dial. */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Someone';
  return parts
    .map((w) =>
      w.length <= 2
        ? `${w[0]}•`
        : `${w.slice(0, 2)}${'•'.repeat(Math.min(w.length - 2, 3))}`
    )
    .join(' ');
}

/** "+919876543210" → "98•••••210". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '•'.repeat(Math.max(digits.length, 4));
  const visible = digits.length > 10 ? digits.slice(-10) : digits;
  return `${visible.slice(0, 2)}${'•'.repeat(visible.length - 5)}${visible.slice(-3)}`;
}
