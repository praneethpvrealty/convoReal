import { BRANDING } from '@/config/branding';
import { hostMatchesDomain, safeFetch } from '@/lib/http/safe-fetch-url';
import { isCurrentStoragePublicUrl, storagePublicUrl } from '@/lib/storage/url';

/**
 * Where a template's header sample may be fetched from.
 *
 * Meta takes the sample as an uploaded file, so the server fetches the
 * URL on the payload and uploads the bytes. Every sample the app itself
 * produces lives in one of two places: the account's upload in public
 * storage, or a `/brand/...` asset the deployment serves for the
 * built-in templates. Anything else is a URL someone typed into the
 * request, and fetching that would let a signed-in user point the
 * server at any address it can reach.
 */

function siteOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const value of [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    BRANDING.websiteUrl,
  ]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      continue;
    }
  }
  return origins;
}

export function isOwnSampleUrl(url: URL): boolean {
  if (isCurrentStoragePublicUrl(url)) return true;
  if (siteOrigins().has(url.origin)) return true;
  return (
    url.port === '' && hostMatchesDomain(url.hostname, [BRANDING.baseDomain])
  );
}

/** Throws `UnsafeUrlError` before any request when the URL is not the app's own. */
export function fetchTemplateSample(rawUrl: string): Promise<Response> {
  return safeFetch(storagePublicUrl(rawUrl), {
    httpsOnly: true,
    allow: isOwnSampleUrl,
  });
}
