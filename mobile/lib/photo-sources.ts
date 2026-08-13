// Port of the web's src/lib/inventory/photo-sources.ts, so a gated
// listing's gallery is the same set of photos in the same order on both
// surfaces. Ported rather than imported: @shared/ is a types-only alias
// here. src/lib/mobile-parity.test.ts pins the ordering.
//
// Making a listing confidential moves its photos into the guarded
// bucket; `images` goes empty and the gallery must read the proxy
// instead, which re-checks the viewer on every request.

export interface PhotoSource {
  /** Public bucket path, or the proxy route for a guarded photo. */
  url: string;
  /** True when it streams through the authenticated proxy, which needs
   *  an absolute URL and a bearer header rather than a CDN fetch. */
  guarded: boolean;
}

interface PhotoSourceInput {
  id: string;
  images?: string[] | null;
  private_images?: string[] | null;
}

const clean = (v: string[] | null | undefined): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];

export function guardedPhotoPath(propertyId: string, index: number): string {
  return `/api/properties/${propertyId}/private-images/${index}`;
}

/** Public photos first, then guarded ones. */
export function internalPhotoSources(p: PhotoSourceInput): PhotoSource[] {
  const pub = clean(p.images).map((url) => ({ url, guarded: false }));
  const guarded = clean(p.private_images).map((_, i) => ({
    url: guardedPhotoPath(p.id, i),
    guarded: true,
  }));
  return [...pub, ...guarded];
}

export function internalPhotoCount(p: PhotoSourceInput): number {
  return clean(p.images).length + clean(p.private_images).length;
}

/** What a thumbnail says when there is no photo to render. A guarded
 *  listing's photos are stripped for viewers who may not see them, and
 *  only `private_images_count` survives — without it the withheld
 *  gallery looks identical to a listing with no photos at all. */
export function emptyPhotoLabel(
  p: PhotoSourceInput & { private_images_count?: number | null }
): string {
  const withheld = p.private_images_count ?? 0;
  if (internalPhotoCount(p) > 0 || withheld <= 0) return 'No photos uploaded';
  return `${withheld} photo${withheld === 1 ? '' : 's'} · confidential`;
}
