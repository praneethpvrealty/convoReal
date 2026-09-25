import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { File } from 'expo-file-system';

import { ApiError, apiResponse } from '@/lib/api';
import { mediaCacheDir } from '@/lib/media-cache';
import { CACHEABLE_MEDIA_TYPES, mediaCacheFileName } from '@/lib/media-source';

function cachedFile(path: string): File | null {
  for (const type of [...CACHEABLE_MEDIA_TYPES, null]) {
    const file = new File(mediaCacheDir(), mediaCacheFileName(path, type));
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
    mediaCacheDir(),
    mediaCacheFileName(path, res.headers.get('content-type'))
  );
  file.write(bytes);
  return file.uri;
}

export function mediaFileMissing(uri: string): boolean {
  return !new File(uri).exists;
}

export function discardCachedMedia(path: string): void {
  cachedFile(path)?.delete();
}

export function useMediaFile(path: string | null) {
  const query = useQuery({
    queryKey: ['whatsapp-media-file', path],
    queryFn: () => downloadMedia(path as string),
    enabled: Boolean(path),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: (count, err) =>
      !(err instanceof ApiError && err.status >= 400 && err.status < 500) &&
      count < 2,
  });

  const { data, refetch } = query;
  useEffect(() => {
    if (data && mediaFileMissing(data)) void refetch();
  }, [data, refetch]);

  return query;
}
