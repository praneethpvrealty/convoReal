/**
 * Storage URL resolution.
 *
 * Media (property images/documents/videos, avatars, flow media) is
 * referenced from the database. Historically the upload helpers stored
 * the ABSOLUTE Supabase public URL, which embeds the project ref — so a
 * region migration (new project ref) silently orphaned every stored URL
 * until the data was rewritten.
 *
 * To make that class of bug impossible, always resolve stored values
 * through `storagePublicUrl()` at the read boundary. It:
 *   - builds a public URL from a bucket-relative path
 *     ("property-images/<acct>/img.jpg") — the shape new uploads store;
 *   - re-bases an absolute Supabase storage URL from ANY project ref onto
 *     the CURRENT `NEXT_PUBLIC_SUPABASE_URL` host — so legacy rows and any
 *     future migration resolve to the live project automatically;
 *   - leaves genuinely external URLs (e.g. WhatsApp CDN avatars) untouched.
 */

const PUBLIC_MARKER = '/storage/v1/object/public/';
const RENDER_MARKER = '/storage/v1/render/image/public/';

function base(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
}

/** Resolve a stored media reference to a live public URL. */
export function storagePublicUrl(value: string | null | undefined): string {
  if (!value) return '';
  const v = String(value).trim();
  if (!v) return '';

  if (/^https?:\/\//i.test(v)) {
    // Absolute Supabase storage URL (object or render form) — re-base the
    // origin onto the current project host, preserving the path + query.
    for (const marker of [PUBLIC_MARKER, RENDER_MARKER]) {
      const idx = v.indexOf(marker);
      if (idx !== -1) return `${base()}${v.slice(idx)}`;
    }
    // Some other absolute URL — external, leave as-is.
    return v;
  }

  if (v.startsWith('data:') || v.startsWith('blob:')) return v;

  // Bucket-relative path.
  return `${base()}${PUBLIC_MARKER}${v.replace(/^\/+/, '')}`;
}

/**
 * Extract the bucket-relative object path ("<bucket>/<...>") from a stored
 * value, whether it is already a relative path or an absolute public URL.
 * Returns null if the value is not a Supabase storage reference (e.g. an
 * external URL). Used by deletion/cleanup code that addresses objects by
 * path.
 */
export function storageObjectPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;

  if (/^https?:\/\//i.test(v)) {
    const idx = v.indexOf(PUBLIC_MARKER);
    if (idx === -1) return null;
    const rest = v.slice(idx + PUBLIC_MARKER.length);
    return rest.split('?')[0].replace(/^\/+/, '') || null;
  }

  if (v.startsWith('data:') || v.startsWith('blob:')) return null;
  return v.split('?')[0].replace(/^\/+/, '') || null;
}
