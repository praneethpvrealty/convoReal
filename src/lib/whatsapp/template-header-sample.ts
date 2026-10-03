// ============================================================
// Where a media-header sample may be downloaded from.
//
// The submit route downloads `header_media_url` on the server to hand
// Meta a Resumable Upload handle, and that URL arrives in the request
// body. Fetching whatever it names would let a signed-in caller point
// the server at an internal or arbitrary host, so only the two places
// a sample legitimately lives are accepted:
//
//   - this project's public Supabase Storage, where the template
//     manager's Upload button puts the file;
//   - the app's own /brand/ assets, which the engine-template builders
//     name from the dashboard origin.
//
// The URL that is fetched is rebuilt from the allow-listed origin and
// the parsed path, never passed through as received, and a redirect is
// followed only when its target passes the same check.
// ============================================================

import { BRANDING } from '@/config/branding';

const STORAGE_PUBLIC_PATH = '/storage/v1/object/public/';
const APP_SAMPLE_PATH = '/brand/';
const MAX_REDIRECTS = 3;

export const HEADER_SAMPLE_URL_MESSAGE =
  'The header sample must be a file uploaded here. Use Upload to add the sample instead of linking to another site.';

export class HeaderSampleUrlError extends Error {
  constructor(message = HEADER_SAMPLE_URL_MESSAGE) {
    super(message);
    this.name = 'HeaderSampleUrlError';
  }
}

interface AllowedSource {
  origin: string;
  hostname: string;
  pathPrefix: string;
}

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function allowedSources(): AllowedSource[] {
  const sources: AllowedSource[] = [];
  const add = (hostname: string | null, pathPrefix: string) => {
    if (!hostname || sources.some((s) => s.hostname === hostname)) return;
    sources.push({ origin: `https://${hostname}`, hostname, pathPrefix });
  };

  add(hostnameOf(process.env.NEXT_PUBLIC_SUPABASE_URL), STORAGE_PUBLIC_PATH);
  add(hostnameOf(process.env.NEXT_PUBLIC_SITE_URL), APP_SAMPLE_PATH);
  add(hostnameOf(process.env.NEXT_PUBLIC_APP_URL), APP_SAMPLE_PATH);
  add(hostnameOf(BRANDING.websiteUrl), APP_SAMPLE_PATH);
  const baseDomain = BRANDING.baseDomain.trim().toLowerCase();
  if (baseDomain) {
    add(baseDomain, APP_SAMPLE_PATH);
    add(`www.${baseDomain}`, APP_SAMPLE_PATH);
  }
  return sources;
}

/**
 * Returns the URL to fetch for a header sample, rebuilt from the
 * allow-listed origin, or throws HeaderSampleUrlError.
 */
export function resolveHeaderSampleUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HeaderSampleUrlError();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new HeaderSampleUrlError();
  }
  const hostname = parsed.hostname.toLowerCase();
  const source = allowedSources().find((s) => s.hostname === hostname);
  if (!source || !parsed.pathname.startsWith(source.pathPrefix)) {
    throw new HeaderSampleUrlError();
  }
  return `${source.origin}${parsed.pathname}${parsed.search}`;
}

export async function fetchHeaderSample(raw: string): Promise<Response> {
  let current = resolveHeaderSampleUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, { redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    current = resolveHeaderSampleUrl(new URL(location, current).href);
  }
  throw new HeaderSampleUrlError(
    'The header sample link redirects too many times.'
  );
}
