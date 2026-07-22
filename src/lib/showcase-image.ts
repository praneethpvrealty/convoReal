/**
 * Supabase Storage image transformation helper for the public showcase.
 *
 * Property photos are stored as full-resolution originals (200 KB – several
 * MB each). The showcase grid was shipping ~35 originals eagerly, which is
 * what made share links take seconds to become usable. Supabase's render
 * endpoint resizes + re-encodes on the fly and CDN-caches the result, so a
 * 640px card image is ~65 KB instead of ~200 KB+.
 *
 * Non-Supabase URLs (or anything unexpected) pass through untouched, and
 * consumers add an onError fallback to the original URL so a disabled
 * transformation add-on degrades gracefully instead of breaking photos.
 */

const OBJECT_MARKER = '/storage/v1/object/public/';
const RENDER_MARKER = '/storage/v1/render/image/public/';

export function showcaseImageUrl(
  url: string | null | undefined,
  width: number,
  quality: number = 75
): string {
  if (!url) return '';
  const idx = url.indexOf(OBJECT_MARKER);
  if (idx === -1 || url.includes('?')) return url;
  const path = url.slice(idx + OBJECT_MARKER.length);
  return `${url.slice(0, idx)}${RENDER_MARKER}${path}?width=${width}&quality=${quality}`;
}

/** Standard widths used across the showcase so the CDN cache stays hot.
 *  thumb is 2x the largest thumbnail CSS box (~64-80px) so 3x-DPR phones
 *  don't upscale — 160 rendered visibly soft there. */
export const SHOWCASE_IMAGE_WIDTHS = {
  card: 640,
  hero: 1280,
  thumb: 320,
} as const;
