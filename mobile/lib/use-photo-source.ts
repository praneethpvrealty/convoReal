import { useQuery } from '@tanstack/react-query';
import type { ImageSourcePropType } from 'react-native';

import { apiFetch } from '@/lib/api';
import type { PhotoSource } from '@/lib/photo-sources';
import { storagePublicUrl } from '@/lib/storage-url';

/** Links are signed for ten minutes; refresh well before they lapse. */
const SIGNED_LINK_STALE_MS = 5 * 60 * 1000;

/**
 * Resolves listing photos for `<Image>`.
 *
 * A public photo is a CDN fetch. A guarded one — a confidential
 * listing's, which lives in a bucket with no public read policy — is
 * exchanged for a short-lived signed link through `apiFetch`. Handing
 * `<Image>` the proxy URL with a bearer header does not work: the image
 * loader drops the header (and a 308 to the canonical host strips it
 * regardless), so every guarded photo came back 401 and rendered blank.
 *
 * Returns `null` while the links are still resolving *if* any guarded
 * photo is in the set, so a gallery does not flash broken tiles.
 */
export function usePhotoSources(
  sources: PhotoSource[]
): ImageSourcePropType[] | null {
  const guardedPaths = sources.filter((s) => s.guarded).map((s) => s.url);

  const signed = useQuery({
    queryKey: ['guarded-photo-links', guardedPaths],
    queryFn: () =>
      Promise.all(
        guardedPaths.map((path) =>
          apiFetch<{ data: { url: string } }>(`${path}?format=json`)
            .then((res) => res.data.url)
            .catch(() => '')
        )
      ),
    enabled: guardedPaths.length > 0,
    staleTime: SIGNED_LINK_STALE_MS,
    refetchInterval: SIGNED_LINK_STALE_MS,
  });

  if (guardedPaths.length > 0 && !signed.data) return null;

  const links = new Map(
    guardedPaths.map((path, i) => [path, signed.data?.[i] ?? ''])
  );
  return sources
    .map((s) => (s.guarded ? links.get(s.url) : storagePublicUrl(s.url)))
    .filter((uri): uri is string => Boolean(uri))
    .map((uri) => ({ uri }));
}
