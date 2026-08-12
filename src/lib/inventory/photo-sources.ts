// ============================================================
// The photos a teammate sees for one listing.
//
// Making a listing confidential MOVES its photos out of the public
// bucket into the guarded one, so the old CDN URLs stop resolving —
// that is the point, and it is what stops a forwarded link from
// carrying the pictures. But every internal view read `images` alone,
// so the agent's own gallery went empty the moment they gated a
// listing: the photos were fine, nothing was reading them.
//
// Guarded photos come back through the auth-gated proxy, which
// re-checks the viewer on every request. Publishing paths — share
// links, flyers, portal post kits — deliberately do NOT use this: a
// gated listing's photos must not ride out on a channel that has no
// viewer to check.
// ============================================================

export interface PhotoSource {
  /** Public bucket path, or the proxy route for a guarded photo. */
  url: string;
  /** True when it streams through the authenticated proxy. */
  guarded: boolean;
}

interface PhotoSourceInput {
  id: string;
  images?: string[] | null;
  private_images?: string[] | null;
}

const clean = (v: string[] | null | undefined): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];

/** Proxy route for one guarded photo. Index-based: the route reads the
 *  same `private_images` array, so position is the identifier. */
export function guardedPhotoPath(propertyId: string, index: number): string {
  return `/api/properties/${propertyId}/private-images/${index}`;
}

/**
 * Public photos first, then guarded ones — so a listing that was gated
 * after upload keeps the cover image an agent already recognises, and a
 * partially gated one does not reorder itself.
 */
export function internalPhotoSources(p: PhotoSourceInput): PhotoSource[] {
  const pub = clean(p.images).map((url) => ({ url, guarded: false }));
  const guarded = clean(p.private_images).map((_, i) => ({
    url: guardedPhotoPath(p.id, i),
    guarded: true,
  }));
  return [...pub, ...guarded];
}

/** How many photos a listing has across both buckets — the count a
 *  gallery shows, which is not `images.length` once anything is gated. */
export function internalPhotoCount(p: PhotoSourceInput): number {
  return clean(p.images).length + clean(p.private_images).length;
}
