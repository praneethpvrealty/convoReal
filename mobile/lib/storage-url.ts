import { ENV } from './env';

/**
 * Resolve a stored Supabase Storage reference to a live public URL.
 *
 * Property images, avatars, etc. are stored in the DB as bucket-relative
 * paths ("property-images/<acct>/img.jpg") — the web app builds the URL
 * at read time via src/lib/storage/url.ts, and the mobile app must do the
 * same. Mirrors that resolver:
 *   - bucket-relative path        -> build a public URL on the current host
 *   - absolute Supabase URL       -> re-base onto EXPO_PUBLIC_SUPABASE_URL
 *   - any other URI (file:, data:, external https) -> left unchanged
 *
 * Returns '' for empty input so `uri ? <Image/> : <Placeholder/>` checks
 * keep working.
 */
const PUBLIC_MARKER = '/storage/v1/object/public/';
const RENDER_MARKER = '/storage/v1/render/image/public/';

function base(): string {
  return ENV.supabaseUrl.replace(/\/+$/, '');
}

export function storagePublicUrl(value: string | null | undefined): string {
  if (!value) return '';
  const v = String(value).trim();
  if (!v) return '';

  if (/^https?:\/\//i.test(v)) {
    for (const marker of [PUBLIC_MARKER, RENDER_MARKER]) {
      const idx = v.indexOf(marker);
      if (idx !== -1) return `${base()}${v.slice(idx)}`;
    }
    return v;
  }

  // Any other URI scheme (file:, content:, data:, blob:, asset:) — as-is.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;

  return `${base()}${PUBLIC_MARKER}${v.replace(/^\/+/, '')}`;
}
