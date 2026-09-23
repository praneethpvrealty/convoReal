export const SOURCE_MAX_BYTES = 14 * 1024 * 1024;

export const IGR_GUIDANCE_PAGE =
  'https://igr.karnataka.gov.in/72/revised-guidelines-value/en';

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 45_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

export function isAllowedSourceUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (url.port === '' || url.port === '443') &&
    (host === 'karnataka.gov.in' || host.endsWith('.karnataka.gov.in'))
  );
}

export interface DiscoveredPdf {
  url: string;
  label: string;
  district: string | null;
  registration_district?: string;
  sro?: string;
  kind: 'notification' | 'corrigendum';
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1].toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanLabel(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function fileLabel(url: URL): string {
  const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  return (
    name
      .replace(/\.pdf$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim() || 'Notification'
  );
}

export function isPdfHref(url: URL): boolean {
  return /\.pdf$/i.test(url.pathname);
}

export function extractPdfLinks(
  html: string,
  baseUrl: string
): DiscoveredPdf[] {
  const seen = new Set<string>();
  const out: DiscoveredPdf[] = [];
  const anchors = html.matchAll(
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  );
  for (const match of anchors) {
    const href = decodeEntities(
      (match[1] ?? match[2] ?? match[3] ?? '').trim()
    );
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    url.hash = '';
    if (
      !isPdfHref(url) ||
      !isAllowedSourceUrl(url.href) ||
      seen.has(url.href)
    ) {
      continue;
    }
    seen.add(url.href);
    const label = cleanLabel(match[4]).slice(0, 200) || fileLabel(url);
    out.push({
      url: url.href,
      label,
      district: districtFromLabel(`${label} ${fileLabel(url)}`),
      kind: /corrigend/i.test(label) ? 'corrigendum' : 'notification',
    });
  }
  return out;
}

const DISTRICTS: Array<[string, string[]]> = [
  ['Bengaluru Rural', ['bengaluru rural', 'bangalore rural']],
  ['Ramanagara', ['ramanagara', 'ramanagaram', 'bengaluru south']],
  [
    'Bengaluru Urban',
    [
      'bengaluru urban',
      'bangalore urban',
      'bbmp',
      'gandhinagar',
      'gandhinagara',
      'jayanagar',
      'jayanagara',
      'rajajinagar',
      'rajajinagara',
      'shivajinagar',
      'shivajinagara',
      'basavanagudi',
      'bengaluru',
      'bangalore',
    ],
  ],
  ['Bagalkote', ['bagalkote', 'bagalkot']],
  ['Ballari', ['ballari', 'bellary']],
  ['Belagavi', ['belagavi', 'belgaum']],
  ['Bidar', ['bidar']],
  ['Chamarajanagar', ['chamarajanagar', 'chamarajanagara']],
  ['Chikkaballapur', ['chikkaballapur', 'chikkaballapura']],
  ['Chikkamagaluru', ['chikkamagaluru', 'chikmagalur']],
  ['Chitradurga', ['chitradurga']],
  ['Dakshina Kannada', ['dakshina kannada', 'mangaluru', 'mangalore']],
  ['Davanagere', ['davanagere', 'davangere']],
  ['Dharwad', ['dharwad', 'hubballi', 'hubli']],
  ['Gadag', ['gadag']],
  ['Hassan', ['hassan']],
  ['Haveri', ['haveri']],
  ['Kalaburagi', ['kalaburagi', 'gulbarga']],
  ['Kodagu', ['kodagu', 'coorg']],
  ['Kolar', ['kolar']],
  ['Koppal', ['koppal']],
  ['Mandya', ['mandya']],
  ['Mysuru', ['mysuru', 'mysore']],
  ['Raichur', ['raichur']],
  ['Shivamogga', ['shivamogga', 'shimoga']],
  ['Tumakuru', ['tumakuru', 'tumkur']],
  ['Udupi', ['udupi']],
  ['Uttara Kannada', ['uttara kannada', 'karwar']],
  ['Vijayanagara', ['vijayanagara', 'hosapete', 'hospet']],
  ['Vijayapura', ['vijayapura', 'bijapur']],
  ['Yadgir', ['yadgir', 'yadagiri']],
];

export function districtFromLabel(label: string): string | null {
  const text = ` ${label.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  for (const [district, names] of DISTRICTS) {
    if (names.some((name) => text.includes(` ${name} `))) return district;
  }
  return null;
}

function cellUrl(cellHtml: string, baseUrl: string): string | null {
  const candidates = [
    ...cellHtml.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi),
  ].map((m) => m[1] ?? m[2]);
  candidates.push(
    ...[...cellHtml.matchAll(/["']([^"'\s]+\.pdf(?:\?[^"'\s]*)?)["']/gi)].map(
      (m) => m[1]
    )
  );
  for (const raw of candidates) {
    const href = decodeEntities(raw.trim());
    if (!href || href === '#' || /^javascript:/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      url.hash = '';
      if (isAllowedSourceUrl(url.href)) return url.href;
    } catch {
      continue;
    }
  }
  return null;
}

function hasLink(cellHtml: string): boolean {
  return /<a\b|<button\b|\.pdf/i.test(cellHtml);
}

export function extractGuidanceTable(
  html: string,
  baseUrl: string
): DiscoveredPdf[] {
  const heading = cleanLabel(
    html.match(/<h[1-4][^>]*>([^<]*guideline[^<]*)<\/h[1-4]>/i)?.[1] ?? ''
  );
  const out: DiscoveredPdf[] = [];
  const seen = new Set<string>();
  let registrationDistrict = '';

  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => m[1]
    );
    if (cells.length < 3 || !/^\d+$/.test(cleanLabel(cells[0]))) continue;
    const firstLink = cells.findIndex((cell, i) => i > 0 && hasLink(cell));
    if (firstLink < 2) continue;
    const names = cells.slice(1, firstLink).map(cleanLabel);
    if (names.length >= 2 && names[0]) registrationDistrict = names[0];
    const sro = names[names.length - 1];
    if (!sro) continue;

    const district =
      districtFromLabel(registrationDistrict) ?? (registrationDistrict || null);
    const base = [heading, registrationDistrict, sro]
      .filter(Boolean)
      .join(' · ');
    const links: Array<[string | null, DiscoveredPdf['kind']]> = [
      [cellUrl(cells[firstLink], baseUrl), 'notification'],
      [
        cells[firstLink + 1] ? cellUrl(cells[firstLink + 1], baseUrl) : null,
        'corrigendum',
      ],
    ];
    for (const [url, kind] of links) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({
        url,
        label: kind === 'corrigendum' ? `${base} · BDA corrigendum` : base,
        district,
        registration_district: registrationDistrict || undefined,
        sro,
        kind,
      });
    }
  }
  return out;
}

const FILENAME_NOISE = new Set([
  'gv',
  'guidance',
  'guideline',
  'guidelines',
  'value',
  'values',
  'revised',
  'notification',
  'final',
  'pdf',
  'sro',
  'copy',
]);

export interface FileSourceGuess {
  title: string;
  sro: string | null;
  district: string | null;
}

export function sourceFromFilename(filename: string): FileSourceGuess {
  const base = filename
    .replace(/\.pdf$/i, '')
    .replace(/\(\d+\)$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = base
    .split(' ')
    .filter(
      (word) =>
        word &&
        !FILENAME_NOISE.has(word.toLowerCase()) &&
        !/^\d+$/.test(word) &&
        !/^\d{4}(\d{2})?$/.test(word)
    );
  const sro = words.join(' ').trim() || null;
  return {
    title: `Guidance value · ${base || 'Notification'}`,
    sro,
    district: districtFromLabel(base),
  };
}

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchAllowed(
  raw: string,
  fetcher: Fetcher = fetch
): Promise<{ response: Response; url: string }> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAllowedSourceUrl(current)) {
      throw new SourceFetchError(
        'Only https links on karnataka.gov.in can be imported.'
      );
    }
    const response = await fetcher(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ConvoReal guidance value import)',
        Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) {
      throw new SourceFetchError(
        `The site answered ${response.status} for that link.`,
        502
      );
    }
    return { response, url: current };
  }
  throw new SourceFetchError('That link redirects too many times.', 502);
}

export async function readCapped(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SourceFetchError(
      `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      413
    );
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
      throw new SourceFetchError(
        `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB.`,
        413
      );
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

export function isPdfBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export async function discoverPdfs(
  raw: string,
  fetcher: Fetcher = fetch
): Promise<DiscoveredPdf[]> {
  const { response, url } = await fetchAllowed(raw, fetcher);
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/pdf') || isPdfHref(new URL(url))) {
    await response.body?.cancel();
    const label = fileLabel(new URL(url));
    return [
      { url, label, district: districtFromLabel(label), kind: 'notification' },
    ];
  }
  const html = new TextDecoder().decode(
    await readCapped(response, MAX_PAGE_BYTES)
  );
  const rows = extractGuidanceTable(html, url);
  return rows.length ? rows : extractPdfLinks(html, url);
}

export async function downloadPdf(
  raw: string,
  fetcher: Fetcher = fetch
): Promise<{ bytes: Uint8Array; url: string }> {
  const { response, url } = await fetchAllowed(raw, fetcher);
  const bytes = await readCapped(response, SOURCE_MAX_BYTES);
  if (!isPdfBytes(bytes)) {
    throw new SourceFetchError('That link did not return a PDF.', 415);
  }
  return { bytes, url };
}
