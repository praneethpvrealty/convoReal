import { useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';

import { ApiError, apiResponse } from '@/lib/api';
import { mediaCacheFileName } from '@/lib/media-source';

const CACHED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function cachedFile(path: string): File | null {
  for (const type of [...CACHED_TYPES, null]) {
    const file = new File(Paths.cache, mediaCacheFileName(path, type));
    if (file.exists && (file.size ?? 0) > 0) return file;
  }
  return null;
}

async function downloadMedia(path: string): Promise<string> {
  const cached = cachedFile(path);
  if (cached) return cached.uri;

  const res = await apiResponse(path);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new ApiError(404, 'Media no longer available');

  const file = new File(
    Paths.cache,
    mediaCacheFileName(path, res.headers.get('content-type'))
  );
  file.write(bytes);
  return file.uri;
}

export function useMediaFile(path: string | null) {
  return useQuery({
    queryKey: ['whatsapp-media-file', path],
    queryFn: () => downloadMedia(path as string),
    enabled: Boolean(path),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: (count, err) =>
      !(err instanceof ApiError && err.status >= 400 && err.status < 500) &&
      count < 2,
  });
}
