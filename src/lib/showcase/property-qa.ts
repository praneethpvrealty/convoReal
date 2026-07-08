// ============================================================
// Property Q&A core — deterministic, transport-free answers to buyer
// questions from a property's structured fields. No AI, no network,
// no credit cost. The public "Ask about this property" endpoint tries
// this FIRST; only genuinely open-ended questions (negotiability,
// floor, subjective comparisons) fall through to the credit-metered
// AI path. Keeping this pure means it's cheap, instant, abuse-proof,
// and unit-testable.
// ============================================================

import type { Property } from '@/types';

/** Subset of Property the answerer reads. The public showcase payload
 *  is a superset of this, so callers can pass the full row. */
export type QaProperty = Pick<
  Property,
  | 'title' | 'type' | 'listing_type' | 'price' | 'rent_per_month'
  | 'maintenance' | 'advance' | 'gst' | 'location' | 'sublocality'
  | 'city' | 'state' | 'bedrooms' | 'bathrooms' | 'area_sqft'
  | 'area_unit' | 'super_built_area' | 'land_area' | 'land_area_unit'
  | 'facing_direction' | 'features' | 'nearby_highlights'
  | 'property_code' | 'project' | 'rental_income' | 'roi' | 'dimensions'
>;

export interface QaResult {
  /** Deterministic answer, or null when the question needs the AI path. */
  answer: string | null;
  /** The matched intent (for logging/analytics), or null if unmatched. */
  intent: string | null;
}

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function isRent(p: QaProperty): boolean {
  return p.listing_type === 'Rent';
}

function priceAnswer(p: QaProperty): string | null {
  if (isRent(p)) {
    if (!p.rent_per_month) return null;
    let s = `The monthly rent is ${inr(p.rent_per_month)}.`;
    if (p.maintenance) s += ` Maintenance is ${inr(p.maintenance)}/month.`;
    if (p.advance) s += ` Advance/deposit is ${inr(p.advance)}.`;
    return s;
  }
  if (!p.price) return null;
  return `The asking price is ${inr(p.price)}.`;
}

function areaAnswer(p: QaProperty): string | null {
  const parts: string[] = [];
  if (p.area_sqft) parts.push(`${p.area_sqft.toLocaleString('en-IN')} ${p.area_unit || 'sq.ft.'} built-up`);
  if (p.super_built_area) parts.push(`${p.super_built_area.toLocaleString('en-IN')} sq.ft. super built-up`);
  if (p.land_area) parts.push(`${p.land_area.toLocaleString('en-IN')} ${p.land_area_unit || 'sq.ft.'} land area`);
  return parts.length ? `Size: ${parts.join(', ')}.` : null;
}

function bedroomsAnswer(p: QaProperty): string | null {
  return p.bedrooms ? `It's a ${p.bedrooms} BHK.` : null;
}

function bathroomsAnswer(p: QaProperty): string | null {
  return p.bathrooms ? `It has ${p.bathrooms} bathroom${p.bathrooms > 1 ? 's' : ''}.` : null;
}

function locationAnswer(p: QaProperty): string | null {
  const bits = [p.location, p.sublocality, p.city, p.state].filter(Boolean);
  if (!bits.length) return null;
  // De-dupe while preserving order (location often already contains city).
  const seen = new Set<string>();
  const unique = bits.filter((b) => {
    const k = (b as string).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return `It's located in ${unique.join(', ')}.`;
}

function amenitiesAnswer(p: QaProperty): string | null {
  return p.features && p.features.length
    ? `Amenities include: ${p.features.join(', ')}.`
    : null;
}

function facingAnswer(p: QaProperty): string | null {
  return p.facing_direction ? `It faces ${p.facing_direction}.` : null;
}

function nearbyAnswer(p: QaProperty): string | null {
  return p.nearby_highlights && p.nearby_highlights.length
    ? `Nearby: ${p.nearby_highlights.join(', ')}.`
    : null;
}

function typeAnswer(p: QaProperty): string | null {
  if (!p.type) return null;
  const forWhat = isRent(p) ? 'for rent' : 'for sale';
  return `This is a ${p.type} listed ${forWhat}.`;
}

function codeAnswer(p: QaProperty): string | null {
  return p.property_code ? `The property code is ${p.property_code}.` : null;
}

function roiAnswer(p: QaProperty): string | null {
  const parts: string[] = [];
  if (p.rental_income) parts.push(`expected rental income ${inr(p.rental_income)}/month`);
  if (p.roi) parts.push(`ROI/yield ${p.roi}%`);
  return parts.length ? `Investment: ${parts.join(', ')}.` : null;
}

function dimensionsAnswer(p: QaProperty): string | null {
  return p.dimensions ? `Plot dimensions: ${p.dimensions}.` : null;
}

// Questions that must always go to the AI/agent even when they mention
// an answerable field. "Is the price negotiable?" contains "price" but
// the buyer wants a judgement call, not the sticker number; floor/loan/
// legal questions are outside the structured data entirely. Checked
// before the structured matchers so these never get a canned reply.
const ESCALATE_PATTERN =
  /\b(negotiab|negotiate|bargain|discount|best price|final price|lowest|loan|home loan|emi|down payment|which floor|what floor|floor number|legal|approv|clearance|khata|rera|possession date|when.*ready|tax|registration)/i;

// Ordered matchers. First matcher whose pattern hits decides the
// outcome: its responder's string is served, or — if the data is
// absent (responder returns null) — the question escalates to AI with
// that intent recorded. Order matters where keywords overlap; more
// specific intents come first. Patterns are leading-boundary-anchored
// only (no trailing \b) so plurals and suffixes still match
// ("bedroom" → "bedrooms", "amenit" → "amenities").
const MATCHERS: { intent: string; pattern: RegExp; respond: (p: QaProperty) => string | null }[] = [
  { intent: 'roi', pattern: /\b(roi|yield|rental income|return on|investment return)/i, respond: roiAnswer },
  { intent: 'price', pattern: /\b(price|cost|rate|how much|budget|rent|deposit|advance|maintenance)/i, respond: priceAnswer },
  { intent: 'bedrooms', pattern: /\b(bedroom|bhk|how many rooms)/i, respond: bedroomsAnswer },
  { intent: 'bathrooms', pattern: /\b(bathroom|bath|toilet|washroom)/i, respond: bathroomsAnswer },
  { intent: 'area', pattern: /\b(area|size|sq\.?\s?ft|square feet|sqft|built.?up|carpet|how big)/i, respond: areaAnswer },
  { intent: 'dimensions', pattern: /\b(dimension|plot size|length|breadth)/i, respond: dimensionsAnswer },
  { intent: 'nearby', pattern: /\b(nearby|near by|close to|distance|metro|school|hospital|airport|station|landmark)/i, respond: nearbyAnswer },
  { intent: 'location', pattern: /\b(where|located|location|address|which area|what area|locality|city)/i, respond: locationAnswer },
  { intent: 'amenities', pattern: /\b(amenit|facilit|feature|gym|pool|parking|lift|clubhouse|security|power backup)/i, respond: amenitiesAnswer },
  { intent: 'facing', pattern: /\b(facing|direction|vastu|east|west|north|south)/i, respond: facingAnswer },
  { intent: 'type', pattern: /\b(type|kind of|apartment|villa|plot|flat|house|is it for (sale|rent)|sale or rent)/i, respond: typeAnswer },
  { intent: 'code', pattern: /\b(property code|reference (number|no)|listing id|ref no)/i, respond: codeAnswer },
];

/**
 * Attempts a deterministic answer to a buyer's question from the
 * property's structured fields. Returns `{ answer: null }` when the
 * question is an escalate-always type, doesn't match a known intent, or
 * matches one whose data is absent — all signal the caller to escalate
 * to the AI path.
 */
export function answerFromPropertyData(question: string, property: QaProperty): QaResult {
  const q = (question || '').trim();
  if (!q) return { answer: null, intent: null };
  if (ESCALATE_PATTERN.test(q)) return { answer: null, intent: null };

  for (const m of MATCHERS) {
    if (m.pattern.test(q)) {
      return { answer: m.respond(property), intent: m.intent };
    }
  }
  return { answer: null, intent: null };
}

/**
 * Builds compact labelled grounding text for the AI path — every known
 * field, so the model answers open-ended questions from real listing
 * data instead of hallucinating. Internal/CRM fields (notes, owner
 * contact, agent identity) are deliberately excluded.
 */
export function buildPropertyContext(property: QaProperty): string {
  const p = property;
  const lines: string[] = [];
  const add = (label: string, val: unknown) => {
    if (val === null || val === undefined || val === '') return;
    if (Array.isArray(val)) {
      if (val.length === 0) return;
      lines.push(`${label}: ${val.join(', ')}`);
    } else {
      lines.push(`${label}: ${val}`);
    }
  };

  add('Title', p.title);
  add('Type', p.type);
  add('Listing', p.listing_type);
  if (isRent(p)) {
    add('Rent (per month)', p.rent_per_month ? inr(p.rent_per_month) : null);
    add('Maintenance (per month)', p.maintenance ? inr(p.maintenance) : null);
    add('Advance/Deposit', p.advance ? inr(p.advance) : null);
    add('GST', p.gst ?? null);
  } else {
    add('Price', p.price ? inr(p.price) : null);
  }
  add('Location', [p.location, p.sublocality, p.city, p.state].filter(Boolean).join(', '));
  add('Project', p.project);
  add('Bedrooms (BHK)', p.bedrooms ?? null);
  add('Bathrooms', p.bathrooms ?? null);
  add('Built-up area', p.area_sqft ? `${p.area_sqft} ${p.area_unit || 'sq.ft.'}` : null);
  add('Super built-up area', p.super_built_area ? `${p.super_built_area} sq.ft.` : null);
  add('Land area', p.land_area ? `${p.land_area} ${p.land_area_unit || 'sq.ft.'}` : null);
  add('Dimensions', p.dimensions);
  add('Facing', p.facing_direction);
  add('Amenities', p.features);
  add('Nearby highlights', p.nearby_highlights);
  add('Rental income (per month)', p.rental_income ? inr(p.rental_income) : null);
  add('ROI/Yield (%)', p.roi ?? null);
  add('Property code', p.property_code);

  return lines.join('\n');
}

/** System instruction for the AI path. Grounds the model to the given
 *  property, keeps it honest about unknowns, and bars it from inventing
 *  commercially sensitive facts (negotiability, legal/loan advice). */
export const PROPERTY_QA_SYSTEM_PROMPT =
  `You are a helpful assistant answering a prospective buyer's questions about ONE specific real estate listing. ` +
  `Answer ONLY from the property details provided. Keep replies short (1-3 sentences), factual, and friendly. ` +
  `If the answer isn't in the details, say you don't have that information and suggest they ask the agent directly — ` +
  `do NOT guess. Never promise a discount, confirm negotiability, quote loan/EMI figures, or give legal advice; ` +
  `for those, tell them the agent will help. Do not invent amenities, dimensions, or approvals that aren't listed.`;
