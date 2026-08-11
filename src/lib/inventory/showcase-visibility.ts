// ============================================================
// Showcase visibility — page-level gating for a listing's public URL
// (migration 254), sitting above the field-level location guard.
//
// The location guard answers "may this viewer see the address?". This
// answers the earlier question: "may this viewer see the listing at
// all?". For a confidential mandate the specs, the photo set and the
// exact price identify the property to anyone working the same
// micro-market, so masking the address alone does not keep the owner's
// confidence.
//
// A teaser is built by REDUCTION at serialization — never by hiding
// fields in the UI. The public payload is serialized into the RSC
// stream of every showcase render and is readable via view-source, so
// a withheld field must not leave the server. `toPublicListingView`
// below is the single chokepoint every public surface must call; it
// layers over `toPublicPropertyView` rather than the reverse, so the
// location guard stays free of any dependency on this module.
//
// A share grant carrying `reveal_listing` (migration 254) opens the
// page for the one link it was minted for — the same widen-only,
// expiring, revocable key the share dialog already mints.
// ============================================================

import type { Property } from '@/types';
import {
  isLocationGuarded,
  localityLabel,
  toPublicPropertyView,
} from '@/lib/inventory/location-guard';
import type { GrantedReveals } from '@/lib/inventory/share-grants';

export type ShowcaseVisibility = 'open' | 'teaser';

type VisibilityFields = {
  showcase_visibility?: string | null;
};

/** NULL derives to 'open': gating is a deliberate per-listing decision,
 *  not something a property type should switch on by itself. The
 *  location guard already covers the type-driven half of this. */
export function effectiveShowcaseVisibility(
  p: VisibilityFields
): ShowcaseVisibility {
  return p.showcase_visibility === 'teaser' ? 'teaser' : 'open';
}

export function isTeaserGated(p: VisibilityFields): boolean {
  return effectiveShowcaseVisibility(p) === 'teaser';
}

/**
 * Everything a stranger holding a teaser-gated URL may receive. Enough
 * to know whether the listing is worth asking about, not enough to
 * identify which property it is.
 *
 * Deliberately excluded and worth naming, because each has leaked a
 * listing before: `description` (owner names, landmarks, the road),
 * `title` (routinely carries the address — a synthetic one is built
 * instead), `price` (an exact figure plus a locality is near-unique in
 * a thin market), `area_sqft` / `land_area` / `dimensions` (the same,
 * against a survey record), `project`, `nearby_highlights`,
 * `video_url`, `youtube_video_id`, `property_code`.
 */
export const TEASER_PROPERTY_FIELDS = [
  'id',
  'account_id',
  'user_id',
  'type',
  'listing_type',
  'status',
  'bedrooms',
  'sublocality',
  'city',
  'state',
  'is_published',
  'like_count',
  'rating_count',
  'rating_total',
  'created_at',
  'updated_at',
] as const;

const LAKH = 100_000;
const CRORE = 10_000_000;

function formatBandEdge(value: number): string {
  if (value >= CRORE) {
    const cr = value / CRORE;
    return `₹${Number.isInteger(cr) ? cr : cr.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} Cr`;
  }
  return `₹${Math.round(value / LAKH)} L`;
}

/**
 * A price wide enough to shop against and too wide to fingerprint with.
 * Bands are proportional (25% of the lower edge, rounded to a readable
 * step) rather than fixed, so a ₹45 L flat and a ₹12 Cr villa are both
 * placed usefully.
 */
export function priceBand(price?: number | null): string | null {
  if (!price || price <= 0) return null;
  const step =
    price >= CRORE ? CRORE / 2 : price >= LAKH * 50 ? LAKH * 25 : LAKH * 10;
  const lower = Math.floor(price / step) * step;
  return `${formatBandEdge(lower)} – ${formatBandEdge(lower + step)}`;
}

/** The headline a teaser card shows instead of the stored title, which
 *  routinely carries the street or the project name. */
export function teaserTitle(p: {
  type?: string | null;
  bedrooms?: number | null;
  sublocality?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  const bhk = p.bedrooms && p.bedrooms > 0 ? `${p.bedrooms} BHK ` : '';
  const type = p.type || 'Property';
  return `${bhk}${type} in ${localityLabel(p)}`;
}

/**
 * Reduces a row to its teaser. The cover photo survives only when the
 * listing is not location-guarded: for a villa or a plot the facade is
 * the address, so a guarded listing shows no photograph at all until
 * the gate opens.
 */
export function toTeaserPropertyView(p: Property): Property {
  const view: Record<string, unknown> = {};
  for (const key of TEASER_PROPERTY_FIELDS) {
    view[key] = p[key as keyof Property];
  }
  const guarded = isLocationGuarded(p);
  const coverImage = guarded ? null : (p.images?.[0] ?? null);

  view.title = teaserTitle(p);
  view.location = localityLabel(p);
  view.images = coverImage ? [coverImage] : [];
  view.price = null;
  view.price_band = priceBand(p.price);
  view.image_count = p.images?.length ?? 0;
  view.location_guarded = guarded;
  view.location_revealed = false;
  view.private_images_revealed = false;
  view.teaser_gated = true;
  return view as unknown as Property;
}

/**
 * The public serializer every showcase surface must call. A
 * teaser-gated listing is reduced to its stub unless the link carries a
 * grant that opened it; everything else falls through to the location
 * guard unchanged.
 *
 * The grant is checked for THIS property by the caller (see
 * `resolveShareGrant`) — passing a grant minted for another listing
 * here would open the wrong page.
 */
export function toPublicListingView(
  p: Property,
  opts: { revealExact: boolean; granted?: GrantedReveals }
): Property {
  if (isTeaserGated(p) && opts.granted?.listing !== true) {
    return toTeaserPropertyView(p);
  }
  return toPublicPropertyView(p, opts);
}
