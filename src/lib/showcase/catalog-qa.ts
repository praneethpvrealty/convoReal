// ============================================================
// Catalog Q&A — the whole-inventory sibling of property-qa.ts. The
// showcase lead bot answers across every published listing ("anything
// in Whitefield under 2cr?"), not one page's property, so the cheap
// deterministic layer here works over aggregates: counts, price bands,
// which areas and types are actually stocked. Only genuinely open-ended
// questions fall through to the credit-metered AI path.
// ============================================================

import type { Property } from '@/types';
import { REPLY_LANGUAGE_RULE } from '@/lib/languages';

export type CatalogListing = Pick<
  Property,
  | 'title'
  | 'type'
  | 'listing_type'
  | 'price'
  | 'rent_per_month'
  | 'location'
  | 'sublocality'
  | 'city'
  | 'bedrooms'
  | 'bathrooms'
  | 'area_sqft'
  | 'area_unit'
  | 'land_area'
  | 'land_area_unit'
  | 'property_code'
  | 'project'
  | 'features'
  | 'roi'
>;

export interface CatalogQaResult {
  answer: string | null;
  intent: string | null;
}

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function priceOf(listing: CatalogListing): number | null {
  if (listing.listing_type === 'Rent') return listing.rent_per_month ?? null;
  return listing.price || null;
}

function distinct(values: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const label = (value || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, label);
  }
  return [...seen.values()];
}

function listPhrase(items: string[], max = 6): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const joined =
    shown.length > 1
      ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
      : shown[0] || '';
  return rest > 0 ? `${joined} (+${rest} more)` : joined;
}

function countAnswer(listings: CatalogListing[]): string | null {
  if (!listings.length) return null;
  const rentals = listings.filter((l) => l.listing_type === 'Rent').length;
  const sales = listings.length - rentals;
  const parts: string[] = [];
  if (sales) parts.push(`${sales} for sale`);
  if (rentals) parts.push(`${rentals} for rent`);
  return `There are ${listings.length} listings live right now — ${parts.join(' and ')}.`;
}

function priceRangeAnswer(listings: CatalogListing[]): string | null {
  const sale = listings
    .filter((l) => l.listing_type !== 'Rent')
    .map((l) => l.price)
    .filter((p): p is number => Boolean(p));
  const rent = listings
    .map((l) => l.rent_per_month)
    .filter((p): p is number => Boolean(p));
  const parts: string[] = [];
  if (sale.length)
    parts.push(
      `sale prices run ${inr(Math.min(...sale))} to ${inr(Math.max(...sale))}`
    );
  if (rent.length)
    parts.push(
      `rents run ${inr(Math.min(...rent))} to ${inr(Math.max(...rent))} a month`
    );
  return parts.length ? `Across what's live, ${parts.join(', and ')}.` : null;
}

function localitiesAnswer(listings: CatalogListing[]): string | null {
  const areas = distinct(
    listings.map((l) => l.sublocality || l.location || l.city)
  );
  return areas.length
    ? `Listings are spread across ${listPhrase(areas, 8)}.`
    : null;
}

function typesAnswer(listings: CatalogListing[]): string | null {
  const types = distinct(listings.map((l) => l.type));
  return types.length ? `The catalog covers ${listPhrase(types)}.` : null;
}

function bedroomsAnswer(listings: CatalogListing[]): string | null {
  const beds = distinct(
    listings.map((l) => (l.bedrooms ? `${l.bedrooms} BHK` : null))
  ).sort((a, b) => parseInt(a) - parseInt(b));
  return beds.length ? `Configurations on offer: ${listPhrase(beds)}.` : null;
}

function roiAnswer(listings: CatalogListing[]): string | null {
  const yields = listings
    .map((l) => l.roi)
    .filter((r): r is number => Boolean(r));
  if (!yields.length) return null;
  return `Yields on the investment listings range from ${Math.min(...yields)}% to ${Math.max(...yields)}%.`;
}

// Judgement calls, paperwork and money questions never get a canned
// reply — the agent owns those, same rule as the per-property bot.
const ESCALATE_PATTERN =
  /\b(negotiab|negotiate|bargain|discount|best price|final price|lowest|loan|home loan|emi|down payment|legal|approv|clearance|khata|rera|possession date|tax|registration|commission|brokerage)/i;

const MATCHERS: {
  intent: string;
  pattern: RegExp;
  respond: (listings: CatalogListing[]) => string | null;
}[] = [
  {
    intent: 'roi',
    pattern: /\b(roi|yield|rental return|return on)/i,
    respond: roiAnswer,
  },
  {
    intent: 'count',
    pattern:
      /\b(how many|number of|total).*(propert|listing|option|flat|plot|unit)|\b(what|anything).*(available|on offer|in stock)/i,
    respond: countAnswer,
  },
  {
    intent: 'price_range',
    pattern:
      /\b(price range|budget range|how much|price band|cheapest|most expensive|starting (price|from))/i,
    respond: priceRangeAnswer,
  },
  {
    intent: 'localities',
    pattern:
      /\b(which (area|locality|localities|part|places?)|what (area|locality|localities)|where.*(propert|listing|available)|areas? (do you|you) (have|cover))/i,
    respond: localitiesAnswer,
  },
  {
    intent: 'types',
    pattern:
      /\b(what (type|kind|sort)|which (type|kind)|types? of propert|categor)/i,
    respond: typesAnswer,
  },
  {
    intent: 'bedrooms',
    pattern: /\b(bhk|bedroom|configuration)/i,
    respond: bedroomsAnswer,
  },
];

/**
 * Deterministic answer across the live catalog, or `{ answer: null }`
 * when the question needs the AI path.
 */
export function answerFromCatalog(
  question: string,
  listings: CatalogListing[]
): CatalogQaResult {
  const q = (question || '').trim();
  if (!q || !listings.length) return { answer: null, intent: null };
  if (ESCALATE_PATTERN.test(q)) return { answer: null, intent: null };

  for (const matcher of MATCHERS) {
    if (matcher.pattern.test(q)) {
      return { answer: matcher.respond(listings), intent: matcher.intent };
    }
  }
  return { answer: null, intent: null };
}

/**
 * Compact one-line-per-listing grounding for the AI path. Capped so a
 * large inventory can't blow the prompt out; the cap is applied by the
 * caller AFTER pre-filtering to what the visitor asked about.
 */
export function buildCatalogContext(
  listings: CatalogListing[],
  limit = 40
): string {
  return listings
    .slice(0, limit)
    .map((l) => {
      const bits: string[] = [l.title];
      if (l.type) bits.push(l.type);
      if (l.listing_type) bits.push(`for ${l.listing_type}`);
      const price = priceOf(l);
      if (price)
        bits.push(
          l.listing_type === 'Rent' ? `${inr(price)}/month` : inr(price)
        );
      const where = distinct([l.sublocality, l.location, l.city]).join(', ');
      if (where) bits.push(where);
      if (l.bedrooms) bits.push(`${l.bedrooms} BHK`);
      if (l.area_sqft) bits.push(`${l.area_sqft} ${l.area_unit || 'sq.ft.'}`);
      else if (l.land_area)
        bits.push(`${l.land_area} ${l.land_area_unit || 'sq.ft.'} land`);
      if (l.roi) bits.push(`ROI ${l.roi}%`);
      if (l.property_code) bits.push(`code ${l.property_code}`);
      return `- ${bits.join(' · ')}`;
    })
    .join('\n');
}

export const CATALOG_QA_SYSTEM_PROMPT =
  `You are a helpful assistant on a real-estate agency's public property portal, answering a visitor's questions about the agency's CURRENT listings. ` +
  `Answer ONLY from the listing lines provided. Keep replies short (1-3 sentences), factual and friendly, and name specific listings when they fit. ` +
  `If nothing in the list matches what they asked for, say so plainly and offer to pass their requirement to the agent — do NOT invent listings, prices, areas or amenities. ` +
  `Never promise a discount, confirm negotiability, quote loan/EMI figures, or give legal advice; for those, say the agent will help directly. ` +
  REPLY_LANGUAGE_RULE;
