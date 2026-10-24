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
import { REPLY_LANGUAGE_RULE } from '@/lib/languages';
import { requestsMoreListings } from '@/lib/ai/more-listings';
import {
  asksListingAttribute,
  namedListingAttributes,
} from '@/lib/ai/requirement-signal';
import { formatCurrency } from '@/lib/format/currency';
import {
  listingAvailabilityAnswer,
  listingAvailabilityContext,
  listingStatusCaveat,
} from '@/lib/inventory/listing-status';

/** Subset of Property the answerer reads. The public showcase payload
 *  is a superset of this, so callers can pass the full row. */
export type QaProperty = Pick<
  Property,
  | 'title'
  | 'type'
  | 'listing_type'
  | 'price'
  | 'rent_per_month'
  | 'maintenance'
  | 'advance'
  | 'gst'
  | 'location'
  | 'sublocality'
  | 'city'
  | 'state'
  | 'bedrooms'
  | 'bathrooms'
  | 'area_sqft'
  | 'area_unit'
  | 'super_built_area'
  | 'land_area'
  | 'land_area_unit'
  | 'facing_direction'
  | 'features'
  | 'nearby_highlights'
  | 'property_code'
  | 'project'
  | 'rental_income'
  | 'roi'
  | 'dimensions'
  | 'jv_structure'
  | 'owner_share_percent'
  | 'builder_share_percent'
  | 'goodwill_amount'
  | 'bts_lease_years'
  | 'bts_lock_in_years'
  | 'bts_escalation_percent'
  | 'year_built'
  | 'road_width'
  | 'road_width_unit'
> & {
  /** Optional only for callers that never see an unavailable row (the
   *  public endpoints select Available listings); the WhatsApp Q&A
   *  passes the whole row, status included. */
  status?: Property['status'] | null;
};

export interface QaResult {
  /** Deterministic answer, or null when the question needs the AI path. */
  answer: string | null;
  /** The matched intent (for logging/analytics), or null if unmatched. */
  intent: string | null;
}

function inr(n: number): string {
  return formatCurrency(n, 'INR');
}

/** The locality parts in order, minus any already contained in an
 *  earlier one: `location` usually carries the sublocality and city. */
function locationParts(p: QaProperty): string[] {
  const parts: string[] = [];
  for (const raw of [p.location, p.sublocality, p.city, p.state]) {
    const bit = (raw || '').trim();
    if (!bit) continue;
    const key = bit.toLowerCase();
    if (parts.some((prev) => prev.toLowerCase().includes(key))) continue;
    parts.push(bit);
  }
  return parts;
}

function isRent(p: QaProperty): boolean {
  return p.listing_type === 'Rent';
}

function isRentLike(p: QaProperty): boolean {
  return p.listing_type === 'Rent' || p.listing_type === 'Built to Suit';
}

function isJV(p: QaProperty): boolean {
  return p.listing_type === 'JV/JD';
}

function priceAnswer(p: QaProperty): string | null {
  if (isJV(p)) {
    const parts: string[] = [];
    if (p.owner_share_percent && p.builder_share_percent) {
      parts.push(
        `the proposed share is ${p.owner_share_percent}:${p.builder_share_percent} (owner:builder)${p.jv_structure ? `, ${p.jv_structure}` : ''}`
      );
    }
    if (p.price) parts.push(`estimated project value is ${inr(p.price)}`);
    if (p.goodwill_amount) parts.push(`goodwill of ${inr(p.goodwill_amount)}`);
    if (p.advance) parts.push(`refundable advance of ${inr(p.advance)}`);
    return parts.length
      ? `This is a Joint Venture/Development deal — ${parts.join(', ')}.`
      : null;
  }
  if (isRentLike(p)) {
    if (!p.rent_per_month) return null;
    let s = `The monthly rent is ${inr(p.rent_per_month)}.`;
    if (p.maintenance) s += ` Maintenance is ${inr(p.maintenance)}/month.`;
    if (p.advance) s += ` Advance/deposit is ${inr(p.advance)}.`;
    if (p.listing_type === 'Built to Suit' && p.bts_lease_years) {
      s += ` It's a Built to Suit lease with a ${p.bts_lease_years}-year term${p.bts_lock_in_years ? ` (${p.bts_lock_in_years}-year lock-in)` : ''}.`;
    }
    return s;
  }
  if (!p.price) return null;
  return `The asking price is ${inr(p.price)}.`;
}

function areaAnswer(p: QaProperty): string | null {
  const parts: string[] = [];
  if (p.area_sqft)
    parts.push(
      `${p.area_sqft.toLocaleString('en-IN')} ${p.area_unit || 'sq.ft.'} built-up`
    );
  if (p.super_built_area)
    parts.push(
      `${p.super_built_area.toLocaleString('en-IN')} sq.ft. super built-up`
    );
  if (p.land_area)
    parts.push(
      `${p.land_area.toLocaleString('en-IN')} ${p.land_area_unit || 'sq.ft.'} land area`
    );
  return parts.length ? `Size: ${parts.join(', ')}.` : null;
}

function bedroomsAnswer(p: QaProperty): string | null {
  return p.bedrooms ? `It's a ${p.bedrooms} BHK.` : null;
}

function bathroomsAnswer(p: QaProperty): string | null {
  return p.bathrooms
    ? `It has ${p.bathrooms} bathroom${p.bathrooms > 1 ? 's' : ''}.`
    : null;
}

function locationAnswer(p: QaProperty): string | null {
  const unique = locationParts(p);
  if (!unique.length) return null;
  return `It's located in ${unique.join(', ')}.`;
}

export interface QaAnswerOptions {
  /** The buyer already has a saved requirement, so an unavailable
   *  listing's answer offers to confirm it instead of asking again. */
  briefOnFile?: boolean;
}

export function availabilityAnswer(
  p: QaProperty,
  opts: QaAnswerOptions
): string {
  return listingAvailabilityAnswer(p.status, p.listing_type, opts.briefOnFile);
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
  const forWhat = isRent(p)
    ? 'for rent'
    : p.listing_type === 'Built to Suit'
      ? 'as a Built to Suit lease'
      : isJV(p)
        ? 'for Joint Venture/Development'
        : 'for sale';
  return `This is a ${p.type} listed ${forWhat}.`;
}

function codeAnswer(p: QaProperty): string | null {
  return p.property_code ? `The property code is ${p.property_code}.` : null;
}

function roiAnswer(p: QaProperty): string | null {
  const parts: string[] = [];
  if (p.rental_income)
    parts.push(`expected rental income ${inr(p.rental_income)}/month`);
  if (p.roi) parts.push(`ROI/yield ${p.roi}%`);
  return parts.length ? `Investment: ${parts.join(', ')}.` : null;
}

function dimensionsAnswer(p: QaProperty): string | null {
  if (p.dimensions) return `Plot dimensions: ${p.dimensions}.`;
  if (!p.land_area) return null;
  const size = `${p.land_area.toLocaleString('en-IN')} ${p.land_area_unit || 'sq.ft.'}`;
  return `Land area: ${size}${size.endsWith('.') ? '' : '.'}`;
}

function rentAnswer(p: QaProperty): string | null {
  if (isRentLike(p)) return priceAnswer(p);
  if (!p.rental_income) return null;
  const listedAs = isJV(p)
    ? 'for Joint Venture/Development'
    : 'for sale, not for rent';
  let s = `This property is listed ${listedAs}; the expected rental income is ${inr(p.rental_income)}/month`;
  if (p.roi) s += ` (ROI/yield ${p.roi}%)`;
  return `${s}.`;
}

function leaseAnswer(p: QaProperty): string | null {
  return p.listing_type === 'Built to Suit' && p.bts_lease_years
    ? priceAnswer(p)
    : null;
}

function maintenanceAnswer(p: QaProperty): string | null {
  if (isRentLike(p)) return priceAnswer(p);
  return p.maintenance ? `Maintenance is ${inr(p.maintenance)}/month.` : null;
}

function depositAnswer(p: QaProperty): string | null {
  if (isRentLike(p)) return priceAnswer(p);
  if (isJV(p))
    return p.advance ? `The refundable advance is ${inr(p.advance)}.` : null;
  return null;
}

function roadAnswer(p: QaProperty): string | null {
  return p.road_width
    ? `The approach road is ${p.road_width} ${p.road_width_unit || 'ft'} wide.`
    : null;
}

function ageAnswer(p: QaProperty): string | null {
  if (!p.year_built) return null;
  const age = new Date().getFullYear() - p.year_built;
  if (age < 0) return null;
  return age > 0
    ? `It was built in ${p.year_built}, so it's about ${age} year${age === 1 ? '' : 's'} old.`
    : `It was built in ${p.year_built}.`;
}

// Questions that must always go to the AI/agent even when they mention
// an answerable field. "Is the price negotiable?" contains "price" but
// the buyer wants a judgement call, not the sticker number; floor/loan/
// legal questions are outside the structured data entirely. Checked
// before the structured matchers so these never get a canned reply.
const ESCALATE_PATTERN =
  /\b(negotiab|negotiate|bargain|discount|best price|final price|lowest|loan|home loan|emi|down payment|which floor|what floor|floor number|legal|approv|clearance|khata|rera|possession date|when.*ready|tax|registration|bank (account|transfer)|by bank|(paid|pay|payment|received|credited|deposited|transferred) (in|into|to) (the |a |my |our )?bank\b|cheque|\bcash\b|\bupi\b|\bneft\b|\bimps\b|\brtgs\b|online (payment|transfer)|payment (terms|mode)|mode of payment|(rent|rentals|rental|payment)s? (is|are|comes?|paid|collected|received|credited|deposited)\b[^.?!]{0,20}\b(by|via|through|in|into|on|online)\b|how (is|are|do|does|will|would) (the |you |they )?(rent|rentals?|payments?)( get| be)? (paid|collected|received|come|made|transferred|credited))/i;

// "Is it the pink house or the one next to it?" asks a person to look
// at the photo, and nothing in the listing's fields can do that. The
// type matcher used to claim it on the word "house" and answer with
// the listing's category, which is no answer at all. Matched before
// everything else so it reaches a person, and never a model — but only
// with visual context: a colour on a building, a position relative to
// the listing, or a photo named alongside "which" / "is it". A bare
// "which side is it facing?" stays with the facing matcher.
const PHOTO_LANDMARK_PATTERN =
  /\b((pink|blue|white|yellow|green|red|grey|gray|brown|orange|cream|black|beige|peach) (house|building|gate|wall|one|villa|bungalow)|next to (it|this|that)|beside (it|this|that)|behind (it|this|that)|in front of (it|this|that)|opposite (to )?(it|this|that)|left or right|right or left|corner one|middle one|the one (in|on|with|at|next|beside|behind|near)\b)/i;
const VISUAL_CONTEXT_PATTERN =
  /\b(photo|photos|picture|pictures|pic|pics|image|images|video|snap|screenshot)\b/i;
const POINTS_AT_SOMETHING_PATTERN =
  /\b(which (one|house|building|plot|site|unit|flat|gate|side)\b|is (it|this|that)\b)/i;

/** True when the buyer is asking us to point at something in the
 *  listing's photo: only a person who knows the site can answer it. */
export function asksToIdentifyInPhoto(
  question: string | null | undefined
): boolean {
  const q = (question || '').trim();
  if (!q) return false;
  if (PHOTO_LANDMARK_PATTERN.test(q)) return true;
  return VISUAL_CONTEXT_PATTERN.test(q) && POINTS_AT_SOMETHING_PATTERN.test(q);
}

// Availability is answered from the listing's status, before any other
// matcher: "is this still available?" used to fall past every matcher
// to the model, which saw "Listing: Sale" and nothing about the status,
// and told a buyer an under-contract plot was open. Cannot escalate —
// the status is always known, Available included.
const AVAILABILITY_PATTERN =
  /\b(availab\w*|still (for |on |up for )?(sale|rent|lease|open|there|listed|unsold|on the market)|(is|are) (this|it|that|these|those|the (property|plot|flat|house|villa|site|land|unit|listing)) (still )?(for sale|on sale|up for sale|for rent|on the market|open|live|active|listed|unsold)|sold( out)?|already (taken|booked|gone|blocked)|(is|was) (it|this|that) (taken|booked|gone|blocked)|under contract|off the market|on the market|can i (still )?(buy|book|take|get) (this|it|that)|still (open|active|live)|is (this|it|that) (still )?(open|live|active)|(this|it|that) (is )?(still )?(available|for sale|up for sale|on sale))\b/i;

// Ordered matchers. First matcher whose pattern hits decides the
// outcome: its responder's string is served, or — if the data is
// absent (responder returns null) — the question escalates to AI with
// that intent recorded. Order matters where keywords overlap; more
// specific intents come first. Patterns are leading-boundary-anchored
// only (no trailing \b) so plurals and suffixes still match
// ("bedroom" → "bedrooms", "amenit" → "amenities").
const MATCHERS: {
  intent: string;
  pattern: RegExp;
  respond: (p: QaProperty, opts: QaAnswerOptions) => string | null;
}[] = [
  {
    intent: 'availability',
    pattern: AVAILABILITY_PATTERN,
    respond: availabilityAnswer,
  },
  {
    intent: 'type',
    pattern: /\b(sale|rent) or (sale|rent)\b/i,
    respond: typeAnswer,
  },
  {
    intent: 'age',
    pattern:
      /\b(how old|age of|years? old|built in (the year )?\d{4}|year built|year of construction|construction year|when was (it|this|that|the (building|house|property)) (built|constructed))/i,
    respond: ageAnswer,
  },
  {
    intent: 'road',
    pattern:
      /\b(road width|width of (the )?road|approach road|how wide is (the )?(approach |main |access )?road)\b/i,
    respond: roadAnswer,
  },
  {
    intent: 'roi',
    pattern: /\b(roi|yield|rental income|return on|investment return)/i,
    respond: roiAnswer,
  },
  {
    intent: 'lease',
    pattern: /\b(lease|tenure|lock.?in)/i,
    respond: leaseAnswer,
  },
  {
    intent: 'maintenance',
    pattern: /\bmaintenance/i,
    respond: maintenanceAnswer,
  },
  {
    intent: 'deposit',
    pattern: /\b(deposit|advance)/i,
    respond: depositAnswer,
  },
  {
    intent: 'rent',
    pattern: /\brent/i,
    respond: rentAnswer,
  },
  {
    intent: 'price',
    pattern: /\b(price|cost|rate|how much|budget)/i,
    respond: priceAnswer,
  },
  {
    intent: 'bedrooms',
    pattern: /\b(bedroom|bhk|how many rooms)/i,
    respond: bedroomsAnswer,
  },
  {
    intent: 'bathrooms',
    pattern: /\b(bathroom|bath|toilet|washroom)/i,
    respond: bathroomsAnswer,
  },
  {
    intent: 'dimensions',
    pattern:
      /\b(dimension|measurement|plot size|site size|land size|length|breadth|width|frontage|how wide)/i,
    respond: dimensionsAnswer,
  },
  {
    intent: 'area',
    pattern:
      /\b(area|size|sq\.?\s?ft|square feet|sqft|built.?up|carpet|how big)/i,
    respond: areaAnswer,
  },
  {
    intent: 'nearby',
    pattern:
      /\b(nearby|near by|close to|distance|metro|school|hospital|airport|station|landmark)/i,
    respond: nearbyAnswer,
  },
  {
    intent: 'location',
    pattern:
      /\b(where|located|location|address|which area|what area|locality|city)/i,
    respond: locationAnswer,
  },
  {
    intent: 'amenities',
    pattern:
      /\b(amenit|facilit|feature|gym|pool|parking|lift|clubhouse|security|power backup)/i,
    respond: amenitiesAnswer,
  },
  {
    intent: 'facing',
    pattern: /\b(facing|direction|vastu|east|west|north|south)/i,
    respond: facingAnswer,
  },
  // A plot named by its sides, after every field it could be naming:
  // "where is the 30x40 site" asks for the location, not the size.
  {
    intent: 'dimensions',
    pattern:
      /\b\d{2,3}\s*[x×*]\s*\d{2,3}\b|\b(plot|site|size|measurement)\b[^?.!]{0,30}\b\d{2,3}\s*\/\s*\d{2,3}\b|\b\d{2,3}\s*\/\s*\d{2,3}\b[^?.!]{0,30}\b(plot|site|size|measurement)\b/i,
    respond: dimensionsAnswer,
  },
  {
    intent: 'type',
    pattern:
      /\b(type|kind of|apartment|villa|plot|flat|house|is it for (sale|rent)|sale or rent)/i,
    respond: typeAnswer,
  },
  {
    intent: 'code',
    pattern: /\b(property code|reference (number|no)|listing id|ref no)/i,
    respond: codeAnswer,
  },
];

/**
 * Attempts a deterministic answer to a buyer's question from the
 * property's structured fields. Returns `{ answer: null }` when the
 * question is an escalate-always type, doesn't match a known intent, or
 * matches one whose data is absent — all signal the caller to escalate
 * to the AI path.
 */
export function answerFromPropertyData(
  question: string,
  property: QaProperty,
  opts: QaAnswerOptions = {}
): QaResult {
  const q = (question || '').trim();
  if (!q) return { answer: null, intent: null };
  // "What all are available" asks for other listings, not for this
  // one's status; the ladder answers it with the next matches.
  if (requestsMoreListings(q)) return { answer: null, intent: 'more_listings' };
  if (asksToIdentifyInPhoto(q)) {
    return { answer: null, intent: 'photo_identification' };
  }
  if (ESCALATE_PATTERN.test(q)) return { answer: null, intent: null };

  // "location and measurement pls" names two fields: each one named
  // is answered, in the order the matchers run.
  if (asksListingAttribute(q)) {
    // Every field named must have a matcher; "possession" has none, so
    // "Price and possession" goes whole to the model or a person.
    const byTerm = namedListingAttributes(q).map((term) =>
      MATCHERS.find((m) => m.pattern.test(term))
    );
    if (byTerm.some((m) => !m)) return { answer: null, intent: null };
    const matched = byTerm
      .filter((m): m is (typeof MATCHERS)[number] => !!m)
      .filter((m, i, all) => all.findIndex((o) => o.intent === m.intent) === i);
    if (matched.length > 1) {
      // A field the listing cannot answer sends the whole question on:
      // "price and deposit" on a sale listing is a deposit question too.
      const responded = matched.map((m) => ({
        intent: m.intent,
        answer: m.respond(property, opts),
      }));
      const missing = responded.find((r) => !r.answer);
      if (missing) return { answer: null, intent: missing.intent };
      const caveat = listingStatusCaveat(property.status);
      const text = [...new Set(responded.map((r) => r.answer))].join(' ');
      return {
        answer: caveat ? `${text} ${caveat}` : text,
        intent: matched[0].intent,
      };
    }
  }

  for (const m of MATCHERS) {
    if (m.pattern.test(q)) {
      const answer = m.respond(property, opts);
      // A buyer told the price of an under-contract listing is also
      // told it is under contract, in the same breath.
      const caveat =
        answer && m.intent !== 'availability'
          ? listingStatusCaveat(property.status)
          : null;
      return {
        answer: caveat ? `${answer} ${caveat}` : answer,
        intent: m.intent,
      };
    }
  }
  return { answer: null, intent: null };
}

/**
 * Builds compact labelled grounding text for the AI path — every known
 * field, so the model answers open-ended questions from real listing
 * data instead of hallucinating. Internal/Engine fields (notes, owner
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
  add('Availability', listingAvailabilityContext(p.status));
  if (isRentLike(p)) {
    add('Rent (per month)', p.rent_per_month ? inr(p.rent_per_month) : null);
    add('Maintenance (per month)', p.maintenance ? inr(p.maintenance) : null);
    add('Advance/Deposit', p.advance ? inr(p.advance) : null);
    add('GST', p.gst ?? null);
    if (p.listing_type === 'Built to Suit') {
      add('Lease term (years)', p.bts_lease_years ?? null);
      add('Lock-in period (years)', p.bts_lock_in_years ?? null);
      add('Rent escalation (%)', p.bts_escalation_percent ?? null);
    }
  } else if (isJV(p)) {
    add('Deal structure', p.jv_structure);
    add('Owner share (%)', p.owner_share_percent ?? null);
    add('Builder share (%)', p.builder_share_percent ?? null);
    add('Estimated project value', p.price ? inr(p.price) : null);
    add('Goodwill', p.goodwill_amount ? inr(p.goodwill_amount) : null);
    add('Refundable advance', p.advance ? inr(p.advance) : null);
  } else {
    add('Price', p.price ? inr(p.price) : null);
  }
  add('Location', locationParts(p).join(', '));
  add('Project', p.project);
  add('Bedrooms (BHK)', p.bedrooms ?? null);
  add('Bathrooms', p.bathrooms ?? null);
  add(
    'Built-up area',
    p.area_sqft ? `${p.area_sqft} ${p.area_unit || 'sq.ft.'}` : null
  );
  add(
    'Super built-up area',
    p.super_built_area ? `${p.super_built_area} sq.ft.` : null
  );
  add(
    'Land area',
    p.land_area ? `${p.land_area} ${p.land_area_unit || 'sq.ft.'}` : null
  );
  add('Dimensions', p.dimensions);
  add(
    'Road width',
    p.road_width ? `${p.road_width} ${p.road_width_unit || 'ft'}` : null
  );
  add('Year built', p.year_built ?? null);
  add('Facing', p.facing_direction);
  add('Amenities', p.features);
  add('Nearby highlights', p.nearby_highlights);
  add(
    'Rental income (per month)',
    p.rental_income ? inr(p.rental_income) : null
  );
  add('ROI/Yield (%)', p.roi ?? null);
  add('Property code', p.property_code);

  return lines.join('\n');
}

/** System instruction for the AI path. Grounds the model to the given
 *  property, keeps it honest about unknowns, and bars it from inventing
 *  commercially sensitive facts (negotiability, legal/loan advice).
 *
 *  Speaks as the brokerage, in the first person. On WhatsApp this text
 *  goes out over the agent's OWN number, into a thread where the agent
 *  has already replied as themselves — "please ask the agent directly"
 *  there tells a buyer who has been calling that number "sir" that she
 *  has been talking to something else, and leaves her no idea who to
 *  ask. Deferring is still allowed; it is "let me confirm and come back
 *  to you", never a handoff to a third party. */
export const PROPERTY_QA_SYSTEM_PROMPT =
  `You are answering a prospective buyer's questions about ONE specific real estate listing, speaking AS the brokerage that owns it. ` +
  `Answer ONLY from the property details provided. Keep replies short (1-3 sentences), factual, and friendly. ` +
  `The Availability line is authoritative: when it says the listing is NOT available or not yet confirmed, say so plainly and never describe the listing as available, open, or for sale; when it says Available, you may confirm that. ` +
  `Quote prices exactly as written in the details (for example ₹8.40 Cr), never expanded into full digits. ` +
  `Always use the first person ("we", "I", "let me"). NEVER refer to "the agent" or "the team" in the third person and never tell the buyer to ask someone else — you ARE the person they are talking to. ` +
  `If the answer isn't in the details, say you'll confirm it and come back to them — do NOT guess. ` +
  `Never promise a discount, confirm negotiability, quote loan/EMI figures, or give legal advice; ` +
  `for those, say you'll check and revert. Do not invent amenities, dimensions, or approvals that aren't listed. ` +
  REPLY_LANGUAGE_RULE;
