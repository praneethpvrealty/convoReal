import { lookup } from 'node:dns/promises';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export class PublicFetchError extends Error {
  constructor(
    message: string,
    readonly status = 502
  ) {
    super(message);
    this.name = 'PublicFetchError';
  }
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export type Resolver = (hostname: string) => Promise<string[]>;

export interface PublicUrlOptions {
  httpsOnly?: boolean;
  resolve?: Resolver;
}

export interface PublicFetchOptions extends PublicUrlOptions {
  fetcher?: Fetcher;
  maxRedirects?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? octets
    : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function expandIpv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4Octets(tail);
    if (!v4) return null;
    addr = `${addr.slice(0, lastColon)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
  const out = groups.map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN
  );
  return out.every((n) => Number.isInteger(n)) ? out : null;
}

function isPrivateIpv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const leading = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (leading && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
  if (leading && g5 === 0xffff) {
    return isPrivateIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if (
    g0 === 0x64 &&
    g1 === 0xff9b &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0
  ) {
    return isPrivateIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4Octets(ip);
  if (v4) return isPrivateIpv4(v4);
  const v6 = expandIpv6(ip);
  if (v6) return isPrivateIpv6(v6);
  return true;
}

function isIpLiteral(hostname: string): boolean {
  return ipv4Octets(hostname) !== null || hostname.includes(':');
}

export function parsePublicHttpUrl(
  raw: string,
  options: Pick<PublicUrlOptions, 'httpsOnly'> = {}
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('That is not a valid link.');
  }
  const allowed = options.httpsOnly ? ['https:'] : ['http:', 'https:'];
  if (!allowed.includes(url.protocol)) {
    throw new UnsafeUrlError(
      options.httpsOnly
        ? 'Only https links are allowed.'
        : 'Only http and https links are allowed.'
    );
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('Links with credentials are not allowed.');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new UnsafeUrlError('Links on non-standard ports are not allowed.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    (isIpLiteral(hostname) && isPrivateAddress(hostname))
  ) {
    throw new UnsafeUrlError(
      'Links to private or local addresses are not allowed.'
    );
  }
  return url;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function assertPublicUrl(
  raw: string,
  options: PublicUrlOptions = {}
): Promise<URL> {
  const url = parsePublicHttpUrl(raw, options);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIpLiteral(hostname)) return url;
  let addresses: string[];
  try {
    addresses = await (options.resolve ?? defaultResolve)(hostname);
  } catch {
    throw new UnsafeUrlError('That host could not be resolved.');
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError(
      'Links to private or local addresses are not allowed.'
    );
  }
  return url;
}

export async function fetchPublicUrl(
  raw: string,
  options: PublicFetchOptions = {}
): Promise<{ response: Response; url: string }> {
  const fetcher = options.fetcher ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = await assertPublicUrl(current, options);
    const response = await fetcher(url.href, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: options.headers,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { response, url: url.href };
      current = new URL(location, url.href).href;
      continue;
    }
    return { response, url: url.href };
  }
  throw new PublicFetchError('That link redirects too many times.');
}

export async function readPublicBody(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  const limitMb = Math.round(maxBytes / 1024 / 1024);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PublicFetchError(`That file is over ${limitMb} MB.`, 413);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PublicFetchError(`That file is over ${limitMb} MB.`, 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
