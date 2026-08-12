import { useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import { apiBase, authHeaders } from '@/lib/api';
import type { PhotoSource } from '@/lib/photo-sources';
import { storagePublicUrl } from '@/lib/storage-url';

/**
 * Resolves listing photos for `<Image>`.
 *
 * A public photo is a CDN fetch. A guarded one — a confidential
 * listing's, which lives in a bucket with no public read policy — has
 * to go through the auth-gated proxy with a bearer header, the same
 * transport `MediaImage` uses for WhatsApp media. The token is resolved
 * once for the whole gallery rather than per photo.
 *
 * Returns `null` while the token is still resolving *if* any guarded
 * photo is in the set, so a gallery does not flash broken tiles before
 * the header arrives.
 */
export function usePhotoSources(
  sources: PhotoSource[]
): ImageSourcePropType[] | null {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const needsAuth = sources.some((s) => s.guarded);

  useEffect(() => {
    if (!needsAuth) return;
    let cancelled = false;
    void authHeaders().then((h) => {
      if (!cancelled) setHeaders(h);
    });
    return () => {
      cancelled = true;
    };
  }, [needsAuth]);

  if (needsAuth && !headers) return null;

  return sources.map((s) =>
    s.guarded
      ? { uri: `${apiBase()}${s.url}`, headers: headers ?? undefined }
      : { uri: storagePublicUrl(s.url) }
  );
}
