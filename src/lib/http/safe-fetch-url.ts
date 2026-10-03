import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * The guard for any server-side fetch of a URL the server did not write
 * itself — a link lifted from an inbound email, a URL in a request body.
 *
 * It refuses anything that is not plain http(s), anything carrying
 * credentials, and any host that is, or resolves to, an address inside
 * the deployment's own network: loopback, link-local (which is where the
 * cloud metadata service lives, 169.254.169.254), RFC 1918 and the other
 * non-routable ranges. Callers narrow it further with `allow`, and that
 * allow-list is the real boundary: the address check resolves the name
 * once and `fetch` resolves it again, so on its own it cannot stop a
 * host that answers differently the second time.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface SafeFetchUrlOptions {
  httpsOnly?: boolean;
  allow?: (url: URL) => boolean;
}

const MAX_REDIRECTS = 3;

const internalAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  internalAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96],
  ['2002::', 16],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  internalAddresses.addSubnet(network, prefix, 'ipv6');
}

export function isInternalAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return internalAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

function bareHostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

/** True when `hostname` is one of `domains` or a subdomain of one. */
export function hostMatchesDomain(
  hostname: string,
  domains: readonly string[]
): boolean {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  return domains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

/** The checks that need no network: shape, scheme, credentials, literal IPs. */
export function parseSafeFetchUrl(
  raw: string,
  options: SafeFetchUrlOptions = {}
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a valid absolute URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeUrlError('Only http(s) URLs can be fetched.');
  }
  if (options.httpsOnly && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only https URLs can be fetched.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs carrying credentials cannot be fetched.');
  }
  const host = bareHostname(url);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeUrlError('That host is not reachable from here.');
  }
  if (isIP(host) === 6 || (isIP(host) === 4 && isInternalAddress(host))) {
    throw new UnsafeUrlError('That address is not reachable from here.');
  }
  if (options.allow && !options.allow(url)) {
    throw new UnsafeUrlError('That host is not on the allow-list.');
  }
  return url;
}

const PATH_LITERALS = /%(25|24|26|2B|2C|3A|3B|3D|40)/g;

/**
 * The URL to request, written out again from the parts that were checked
 * rather than passed through as the caller's string.
 *
 * Each part goes through `encodeURIComponent`, so nothing in it can add
 * a path separator, a query or a second host. The characters a URL path
 * already carries literally (and its existing percent-escapes) are put
 * back, which keeps the request byte-for-byte what a portal's tracking
 * link expects. This is also the one shape CodeQL's request-forgery
 * query accepts: it has no notion of a guard function, only of encoded
 * components and of input placed after a `?`.
 */
function requestHref(url: URL): string {
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const host = encodeURIComponent(url.hostname);
  const port = url.port ? `:${encodeURIComponent(url.port)}` : '';
  const path = url.pathname
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(PATH_LITERALS, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      )
    )
    .join('/');
  const base = `${scheme}://${host}${port}${path}`;
  return url.search ? `${base}?${url.search.slice(1)}` : base;
}

/**
 * `parseSafeFetchUrl`, then refuse a name that resolves inside the
 * network. Returns the URL to hand to `fetch`.
 */
export async function assertSafeFetchUrl(
  raw: string,
  options: SafeFetchUrlOptions = {}
): Promise<URL> {
  const url = parseSafeFetchUrl(raw, options);
  const host = bareHostname(url);
  if (isIP(host) !== 0) return new URL(requestHref(url));

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError('That host does not resolve.');
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isInternalAddress(address))
  ) {
    throw new UnsafeUrlError('That host is not reachable from here.');
  }
  return new URL(requestHref(url));
}

/**
 * Fetch a guarded URL, re-checking every redirect hop. A plain `fetch`
 * follows a redirect wherever it points, so an allowed host that
 * redirects would otherwise carry the request past the guard.
 */
export async function safeFetch(
  raw: string,
  options: SafeFetchUrlOptions = {},
  init: Omit<RequestInit, 'redirect'> = {}
): Promise<Response> {
  let next = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeFetchUrl(next, options);
    const response = await fetch(url.href, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) {
      return response;
    }
    next = new URL(location, url).href;
  }
  throw new UnsafeUrlError('Too many redirects.');
}
