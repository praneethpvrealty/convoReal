// ============================================================
// Portal listing parser — turns the raw card text harvested from
// the agent's own portal dashboard into a ParsedListing. Pure
// functions, no network. Deterministic on purpose: raw_text is
// preserved in staging, so parsing can improve (or gain an AI
// fallback) later without re-scraping.
// ============================================================

import type { PortalKey } from '@/lib/portals/post-kit';
import type { HarvestedListing, ParsedListing, ParsedPortalStatus } from './types';

/** "₹1.25 Cr" → 12500000, "85 Lakh"/"85L" → 8500000, "45,00,000" → 4500000. */
export function parseIndianAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.replace(/,/g, ' ').trim();

  const cr = t.match(/(?:₹|rs\.?\s*)?\s*([\d]+(?:\.\d+)?)\s*(?:cr|crore)s?\b/i);
  if (cr) return Math.round(parseFloat(cr[1]) * 1_00_00_000);

  const lakh = t.match(/(?:₹|rs\.?\s*)?\s*([\d]+(?:\.\d+)?)\s*(?:lakh|lac|l)\b/i);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 1_00_000);

  const thousand = t.match(/(?:₹|rs\.?\s*)?\s*([\d]+(?:\.\d+)?)\s*(?:k|thousand)\b/i);
  if (thousand) return Math.round(parseFloat(thousand[1]) * 1_000);

  const plain = text.match(/(?:₹|rs\.?\s*)\s*([\d,]+(?:\.\d+)?)/i) || text.match(/^\s*([\d,]{4,})\s*$/);
  if (plain) {
    const n = parseFloat(plain[1].replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

export function extractBedrooms(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:bhk|bed\s*room|bed\b)/i);
  if (!m) return null;
  const n = Math.round(parseFloat(m[1]));
  return n > 0 && n < 20 ? n : null;
}

const AREA_UNIT_TO_SQFT: Record<string, number> = {
  sqft: 1,
  sqyrd: 9,
  sqyd: 9,
  sqm: 10.764,
  acre: 43_560,
  gunta: 1_089,
  cent: 435.6,
  ground: 2_400,
};

export function extractAreaSqft(text: string): number | null {
  const m = text.match(
    /([\d,]+(?:\.\d+)?)\s*(sq\.?\s*ft|sqft|sq\.?\s*feet|sq\.?\s*yards?|sq\.?\s*yrd|sq\.?\s*m(?:tr|eter)?s?\b|acres?|guntas?|cents?|grounds?)/i
  );
  if (!m) return null;
  const value = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unitRaw = m[2].toLowerCase().replace(/[.\s]/g, '');
  const unit = unitRaw.startsWith('sqf') || unitRaw === 'sqfeet' ? 'sqft'
    : unitRaw.startsWith('sqy') ? 'sqyd'
    : unitRaw.startsWith('sqm') ? 'sqm'
    : unitRaw.startsWith('acre') ? 'acre'
    : unitRaw.startsWith('gunta') ? 'gunta'
    : unitRaw.startsWith('cent') ? 'cent'
    : unitRaw.startsWith('ground') ? 'ground'
    : 'sqft';
  return Math.round(value * AREA_UNIT_TO_SQFT[unit]);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "12 Jan 2026", "Jan 12, 2026", "12/01/2026" (dd/mm) → ISO date. */
export function parseDateToken(text: string | null | undefined): string | null {
  if (!text) return null;

  const dmy = text.match(/(\d{1,2})\s+([a-z]{3,9})[a-z']*\.?,?\s+(\d{4})/i);
  if (dmy) {
    const month = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
    if (month) return toIso(parseInt(dmy[3], 10), month, parseInt(dmy[1], 10));
  }

  const mdy = text.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (mdy) {
    const month = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
    if (month) return toIso(parseInt(mdy[3], 10), month, parseInt(mdy[2], 10));
  }

  const slash = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slash) return toIso(parseInt(slash[3], 10), parseInt(slash[2], 10), parseInt(slash[1], 10));

  return null;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateNear(text: string, labelPattern: RegExp): string | null {
  const m = text.match(labelPattern);
  if (!m || m.index === undefined) return null;
  return parseDateToken(text.slice(m.index, m.index + m[0].length + 24));
}

export function parsePortalStatus(text: string): ParsedPortalStatus {
  const t = text.toLowerCase();
  if (/\b(expired|lapsed)\b/.test(t)) return 'expired';
  if (/\b(under\s*(screening|review|verification)|pending\s*approval|in\s*moderation)\b/.test(t)) return 'under_review';
  if (/\b(deactivated|inactive|deleted|removed|paused)\b/.test(t)) return 'inactive';
  return 'active';
}

/** Keyword → CRM property type (CATEGORY_SUBTYPES vocabulary),
 *  most specific patterns first. */
const TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/agricultural\s*(land|plot)|farm\s*land/i, 'Agricultural Land'],
  [/industrial\s*(land|plot)/i, 'Industrial Land'],
  [/industrial\s*shed/i, 'Industrial Shed'],
  [/industrial\s*building/i, 'Industrial Building'],
  [/warehouse|godown/i, 'Warehouse/ Godown'],
  [/commercial\s*(land|plot)/i, 'Commercial Land'],
  [/mixed[\s-]*use|commercial\s*(building|complex|development)|hypermarket|\bhotel\b/i, 'Commercial Building'],
  [/office\s*space|commercial\s*office|it\s*park|sez/i, 'Commercial Office Space'],
  [/showroom/i, 'Commercial Showroom'],
  [/\bshop\b|retail/i, 'Commercial Shop'],
  [/farm\s*house/i, 'Farm House'],
  [/pent\s*house/i, 'Penthouse'],
  [/studio\s*apartment|1\s*rk/i, 'Studio Apartment'],
  [/builder\s*floor/i, 'Builder Floor Apartment'],
  [/villa/i, 'Villa'],
  [/independent\s*house|residential\s*house/i, 'Residential House'],
  [/residential\s*(land|plot)|\bplot\b|\bland\b/i, 'Residential Land/ Plot'],
  [/flat|apartment/i, 'Flat/ Apartment'],
];

export function inferPropertyType(text: string): string | null {
  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function extractCount(text: string, labels: RegExp): number | null {
  const m = text.match(labels);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** "... in HSR Layout, Bengaluru" → { locality, city }. */
export function extractLocation(text: string): { locality: string | null; city: string | null } {
  const m = text.match(/\b(?:in|at|near)\s+([A-Za-z0-9 .'-]{3,40}?),\s*([A-Za-z .'-]{3,30}?)(?:[\n,.]|$)/m);
  if (m) return { locality: m[1].trim(), city: m[2].trim() };
  const single = text.match(/\b(?:in|at)\s+([A-Za-z0-9 .'-]{3,40}?)(?:[\n,.]|$)/m);
  if (single) return { locality: single[1].trim(), city: null };
  return { locality: null, city: null };
}

export function parseHarvestedListing(portal: PortalKey, item: HarvestedListing): ParsedListing {
  const fields = item.fields || {};
  const text = [item.rawText, ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`)].join('\n');

  const firstLine = item.rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 8 && !/^₹/.test(l))[0] || item.rawText.trim().slice(0, 80);

  const rentListing = /\b(for\s*rent|rent\s*\/\s*lease|monthly\s*rent|per\s*month|\/month|\/mo)\b/i.test(text);

  const priceLabelled =
    parseIndianAmount(fields['price'] || fields['expected price'] || fields['monthly rent']) ??
    parseIndianAmount((text.match(/(?:₹|rs\.?\s)\s*[\d,.]+\s*(?:cr|crore|lakh|lac|l\b|k\b)?/i) || [])[0]);

  const location = extractLocation(text);

  return {
    portal,
    portalListingId: item.listingId,
    listingUrl: item.listingUrl || null,
    rawText: item.rawText,
    title: fields['title'] || firstLine,
    propertyType: fields['property type'] ? inferPropertyType(fields['property type']) : inferPropertyType(text),
    listingFor: rentListing ? 'Rent' : 'Sale',
    price: priceLabelled,
    bedrooms: extractBedrooms(text),
    areaSqft: extractAreaSqft(text),
    locality: fields['locality']?.trim() || location.locality,
    city: fields['city']?.trim() || location.city,
    postedOn: parseDateToken(fields['posted on']) || dateNear(text, /posted\s*(?:on)?/i),
    expiresOn: parseDateToken(fields['expires on']) || dateNear(text, /expir\w*\s*(?:on)?/i),
    portalStatus: parsePortalStatus(fields['status'] || text),
    views: extractCount(text, /([\d,]+)\s*views?\b/i),
    responses: extractCount(text, /([\d,]+)\s*(?:responses?|leads?|enquir(?:y|ies)|contacted)\b/i),
  };
}
