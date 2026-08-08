// ============================================================
// One listing, going to one buyer outside the 24-hour window: which
// template carries it, and what rides in the header.
//
// Both engine templates are Utility, so both are exempt from the
// per-user marketing cap that silently drops Marketing sends (error
// 131049). They differ only in whether they lead with an image — and
// a property message that leads with the property is a different
// message from one that does not.
//
// The photo-first template was reachable only from the manual share
// dialog. Match Radar alerts, buyer match digests and the
// share-property API all sent text, even for a listing with photos
// sitting right there, because each queried the text template's names
// and nothing else. This module is the single answer all four use.
//
// The header image is a SEND-TIME parameter — not part of what Meta
// reviewed — so choosing it costs nothing at the category level.
// ============================================================

import { storagePublicUrl } from '@/lib/storage/url';
import {
  PROPERTY_ALERT_TEMPLATE_NAMES,
  pickPropertyAlertTemplate,
} from '@/lib/whatsapp/property-alert-template';
import {
  PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAMES,
  pickPropertyPhotosTemplate,
} from '@/lib/whatsapp/property-enquiry-photos-template';
import type { ApprovedTemplateCandidate } from '@/lib/whatsapp/pick-approved-template';

/** Every name a property share might send under — the `.in()` list for
 *  the one query each send path makes. */
export const PROPERTY_SHARE_TEMPLATE_NAMES = [
  ...PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAMES,
  ...PROPERTY_ALERT_TEMPLATE_NAMES,
];

/** The first image on a listing that is actually an image — `images`
 *  carries blank strings from half-finished edits. */
export function firstPropertyImage(
  images: string[] | null | undefined,
): string | null {
  return images?.find((img) => img && img.trim().length > 0) ?? null;
}

/**
 * What the template header should carry, as a URL Meta can fetch.
 *
 * The listing's own photo first. Failing that the account's brand card,
 * so a listing with no photos uploaded yet still arrives as something
 * other than a bare block of text. Null when there is neither — the
 * send builder then falls back to the template's review-time sample.
 */
export function shareHeaderImage(params: {
  images?: string[] | null;
  brandImage?: string | null;
}): string | null {
  const photo = firstPropertyImage(params.images);
  if (photo) return storagePublicUrl(photo);
  const brand = params.brandImage?.trim();
  return brand ? storagePublicUrl(brand) : null;
}

/**
 * The template to send under.
 *
 * Photo-first whenever there is an image to lead with — the listing's
 * own, or the account's brand card — falling back to the other template
 * whenever the preferred one is not approved, so a share still goes out
 * while a rename is under review.
 *
 * But category outranks the header. A Marketing template is silently
 * dropped for any recipient at their per-user cap (error 131049), so a
 * plain Utility message that arrives beats a rich Marketing one that
 * does not. An image is worth having; it is not worth the send.
 */
export function pickPropertyShareTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[],
  opts: { hasImage: boolean },
): T | null {
  const photos = pickPropertyPhotosTemplate(rows);
  const text = pickPropertyAlertTemplate(rows);

  const preferred = opts.hasImage ? photos : text;
  const other = opts.hasImage ? text : photos;
  if (!preferred) return other;
  if (!other) return preferred;

  const isUtility = (t: ApprovedTemplateCandidate) => t.category === 'Utility';
  return !isUtility(preferred) && isUtility(other) ? other : preferred;
}
