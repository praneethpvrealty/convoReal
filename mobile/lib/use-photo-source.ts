import { useQuery } from '@tanstack/react-query';
import type { ImageSourcePropType } from 'react-native';

import { apiFetch } from '@/lib/api';
import type { PhotoSource } from '@/lib/photo-sources';
import { storagePublicUrl } from '@/lib/storage-url';

const SIGNED_LINK_STALE_MS = 5 * 60 * 1000;

export function usePhotoSources(
  sources: PhotoSource[]
): ImageSourcePropType[] | null {
  const guardedPaths = sources.filter((s) => s.guarded).map((s) => s.url);

  const signed = useQuery({
    queryKey: ['guarded-photo-links', guardedPaths],
    queryFn: () =>
      Promise.all(
        guardedPaths.map((path) =>
          apiFetch<{ data: { url: string } }>(`${path}?format=json`).then(
            (res) => res.data.url
          )
        )
      ),
    enabled: guardedPaths.length > 0,
    staleTime: SIGNED_LINK_STALE_MS,
    refetchInterval: SIGNED_LINK_STALE_MS,
  });

  if (guardedPaths.length > 0 && !signed.data && !signed.isError) return null;

  const links = new Map(
    guardedPaths.map((path, i) => [path, signed.data?.[i] ?? ''])
  );
  return sources
    .map((s) => (s.guarded ? links.get(s.url) : storagePublicUrl(s.url)))
    .filter((uri): uri is string => Boolean(uri))
    .map((uri) => ({ uri }));
}
