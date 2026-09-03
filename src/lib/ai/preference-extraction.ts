import { generateJson } from './gemini';
import {
  normalizePropertyType,
  PROPERTY_TYPE_VALUES,
} from '@/lib/property-types';

/**
 * AI extraction of structured buyer preferences from a contact's
 * requirements + notes free text. Results are persisted on the
 * contacts.pref_* columns (migration 092) and consumed by the
 * matching engine in src/lib/matching.ts.
 */

export const PROPERTY_CATEGORY_VALUES = [
  'residential',
  'commercial',
  'industrial',
  'agricultural',
  'plot',
] as const;

export type PropertyCategory = (typeof PROPERTY_CATEGORY_VALUES)[number];

export const LISTING_TYPE_VALUES = [
  'Sale',
  'Rent',
  'JV/JD',
  'Built to Suit',
] as const;

export type ListingType = (typeof LISTING_TYPE_VALUES)[number];

/** Keeps only values the matcher's listing-intent gate understands.
 *  Anything a client sends outside the vocabulary is dropped rather
 *  than stored, where it would read as an intent nothing can satisfy. */
export function sanitizeListingTypes(value: unknown): ListingType[] {
  return Array.isArray(value)
    ? value.filter((t): t is ListingType =>
        (LISTING_TYPE_VALUES as readonly string[]).includes(t as string)
      )
    : [];
}

/**
 * Buy-or-rent survives a re-extraction that has nothing to say about it.
 *
 * Every other pref_ column is a reading of the brief text, but intent is
 * also answered deliberately — an agent picking it on the contact form,
 * a lead tapping the WhatsApp ladder, a visitor tapping the showcase
 * assistant — and the prompt returns [] for a brief that never mentions
 * a deal type. Writing that empty result back would erase the answer on
 * the next inbound message. An extraction that DOES read an intent still
 * wins: the text is the newer statement.
 */
export function mergedListingTypes(
  extracted: readonly string[],
  stored: readonly string[] | null | undefined
): string[] {
  return extracted.length > 0 ? [...extracted] : [...(stored ?? [])];
}

export function listingTypesFromCurrentTurn(
  text: string | null | undefined
): ListingType[] | null {
  const value = (text || '').trim();
  if (!value) return null;

  const rejectsRent =
    /\b(?:not interested in|not looking (?:to|for)|do not want|don't want|no longer|instead of|rather than)\s+(?:rent(?:ing|al)?|(?:to\s+)?lease|leasing)\b/i.test(
      value
    );
  const rejectsSale =
    /\b(?:not interested in|not looking (?:to|for)|do not want|don't want|no longer|instead of|rather than)\s+(?:buy(?:ing)?|purchas(?:e|ing)|sale)\b/i.test(
      value
    );
  const wantsRent =
    /\b(?:rent(?:ing|al)?|lease|leasing|tenant|to let)\b/i.test(value) &&
    !rejectsRent;
  const wantsSale =
    /\b(?:buy(?:ing)?|purchas(?:e|ing)|sale|ownership)\b/i.test(value) &&
    !rejectsSale;
  const wantsJv =
    /\b(?:jv|jd|joint venture|joint development|revenue share)\b/i.test(value);
  const wantsBuiltToSuit = /\b(?:built to suit|build to suit|bts)\b/i.test(
    value
  );

  const result: ListingType[] = [];
  if (wantsSale) result.push('Sale');
  if (wantsRent) result.push('Rent');
  if (wantsJv) result.push('JV/JD');
  if (wantsBuiltToSuit) result.push('Built to Suit');
  return result.length > 0 ? result : null;
}

export interface ExtractedPreferences {
  property_types: string[];
  property_categories: PropertyCategory[];
  bhk_min: number | null;
  bhk_max: number | null;
  budget_min: number | null;
  budget_max: number | null;
  /** Plot/built-up size band, canonical square feet ("30x40 site" is
   *  1200-1200; "at least half an acre" is 21780-null). */
  land_area_min_sqft: number | null;
  land_area_max_sqft: number | null;
  areas: string[];
  excluded_areas: string[];
  /** Specific named projects/societies/buildings the buyer wants
   *  (e.g. "Purva Vantage"), distinct from localities in `areas`. */
  projects: string[];
  min_roi: number | null;
  listing_types: ListingType[];
  /** Short buyer-profile labels to SUGGEST as Engine tags (never
   *  auto-attached — an agent confirms each with a tap). */
  suggested_tags: string[];
}

export const EMPTY_PREFERENCES: ExtractedPreferences = {
  property_types: [],
  property_categories: [],
  bhk_min: null,
  bhk_max: null,
  budget_min: null,
  budget_max: null,
  land_area_min_sqft: null,
  land_area_max_sqft: null,
  areas: [],
  excluded_areas: [],
  projects: [],
  min_roi: null,
  listing_types: [],
  suggested_tags: [],
};

/** Cap on suggested tags per contact — suggestions are a nudge, not a
 *  taxonomy dump. */
export const MAX_SUGGESTED_TAGS = 3;

/**
 * Normalize model-emitted tag suggestions: trim, Title Case, drop
 * junk-length values, dedupe case-insensitively, cap the count.
 * Exported for unit tests.
 */
export function normalizeSuggestedTags(vals: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of vals) {
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (trimmed.length < 2 || trimmed.length > 24) continue;
    const titled = trimmed
      .split(' ')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
    const key = titled.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(titled);
    if (out.length >= MAX_SUGGESTED_TAGS) break;
  }
  return out;
}

function parseJsonLenient(raw: string): Record<string, unknown> {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(json)?/, '')
      .replace(/```$/, '')
      .trim();
  }
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Strip comments and trailing commas, then retry
    const repaired = cleaned
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[\]}])/g, '$1');
    return JSON.parse(repaired) as Record<string, unknown>;
  }
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

function toNumberOrNull(val: unknown): number | null {
  if (typeof val === 'number' && isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() && !isNaN(Number(val)))
    return Number(val);
  return null;
}

/**
 * Extracts structured real estate preferences from a contact's free-text
 * requirements and notes. Throws on API/parse failure — callers decide
 * whether to retry or leave the previous extraction in place.
 */
export async function extractContactPreferences(
  sourceText: string
): Promise<ExtractedPreferences> {
  const text = sourceText.trim();
  if (!text) return EMPTY_PREFERENCES;

  const systemInstruction =
    'You are an expert real estate lead analyst for the Indian market. You are given the free-text requirements and notes saved against a BUYER contact. ' +
    'Extract their property-buying preferences as a JSON object with this exact structure:\n' +
    '{\n' +
    `  "property_types": Array of SPECIFIC property types the contact wants, each exactly one of: ${PROPERTY_TYPE_VALUES.map((v) => `'${v}'`).join(', ')}. Empty array if no specific type is stated.,\n` +
    "  \"property_categories\": Array of BROAD categories the contact wants, each exactly one of: 'residential', 'commercial', 'industrial', 'agricultural', 'plot'. Fill this when the text states a category (e.g. \"looking for commercial\") — also derive it from any specific types you listed (e.g. 'Flat/ Apartment' implies 'residential'). Empty array if nothing about type/category is stated.,\n" +
    '  "bhk_min": Minimum bedroom count wanted (numeric, e.g. "2 or 3 BHK" -> 2, "3BHK" -> 3) or null,\n' +
    '  "bhk_max": Maximum bedroom count wanted (e.g. "2 or 3 BHK" -> 3, "3BHK" -> 3) or null,\n' +
    '  "budget_min": Minimum budget in INR (e.g. "above 1 Cr" -> 10000000, "80L to 1.2Cr" -> 8000000) or null,\n' +
    '  "budget_max": Maximum budget in INR (e.g. "under 1.2 Cr" -> 12000000, "budget 90 lakhs" -> 9000000) or null,\n' +
    '  "land_area_min_sqft": Minimum plot/land or built-up size wanted, converted to SQUARE FEET (e.g. "30x40 site" -> 1200, "at least 1 acre" -> 43560, "2400 sqft plot" -> 2400) or null,\n' +
    '  "land_area_max_sqft": Maximum plot/land or built-up size wanted in SQUARE FEET (e.g. "30x40 site" -> 1200, "up to 4000 sqft" -> 4000, "not more than half acre" -> 21780) or null,\n' +
    '  "areas": Array of localities/neighbourhoods/cities the contact WANTS (e.g. ["HSR Layout", "Koramangala"]). Empty array if none or "any location".,\n' +
    '  "excluded_areas": Array of localities the contact explicitly does NOT want (e.g. "not Jayanagar" -> ["Jayanagar"]). Empty array if none.,\n' +
    '  "projects": Array of SPECIFIC named projects/apartments/societies/buildings the contact wants (e.g. ["Purva Vantage", "DSR Rainbow Heights", "Meenakshi Classic"]). These are proper names of developments, NOT localities — put neighbourhoods/areas in "areas" instead. Keep the name as written; drop qualifiers like "(Sector 1)" or "last choice". Empty array if none named.,\n' +
    '  "min_roi": Minimum rental yield / ROI percentage wanted (e.g. "yield above 4%" -> 4) or null,\n' +
    `  "listing_types": Array of deal type(s) the contact wants, each exactly one of: ${LISTING_TYPE_VALUES.map((v) => `'${v}'`).join(', ')}. 'Rent'/'tenant'/'to let' -> 'Rent'. 'Joint venture'/'joint development'/'JV'/'JD'/'revenue share'/'landowner looking for a builder' -> 'JV/JD'. 'Built to suit'/'BTS'/'lease to occupier' -> 'Built to Suit'. An explicit statement of buying — 'buy'/'buying'/'purchase'/'own' — DOES mean 'Sale'; what stays empty is silence. Leave empty if the contact states no deal type at all — do NOT assume 'Sale' by default.,\n` +
    '  "suggested_tags": Array of at most 3 SHORT, reusable buyer-profile labels an agent might tag this contact with, Title Case, each 2-24 chars (e.g. "Investor", "End User", "NRI", "First-Time Buyer", "Rental Income", "Urgent"). Only include labels clearly supported by the text (e.g. "for investment purposes" -> "Investor"; "will let out floors" -> "Rental Income"). Do NOT include locations, budgets, BHK, or property types — those are captured by the other fields. Empty array when nothing profile-like is stated.\n' +
    '}\n\n' +
    'Rules:\n' +
    "1. Convert Indian number formats: 'Crore'/'Cr' = 10000000, 'Lakh'/'L' = 100000, 'k' = 1000. '1.2cr' -> 12000000, '80L' -> 8000000, '₹90 lakh' -> 9000000.\n" +
    "2. A single budget figure with no qualifier (e.g. 'budget 1 Cr') means budget_max, leave budget_min null. '±'/'around'/'approx' also maps to budget_max.\n" +
    "2b. A bare number with NO unit means different things for rent and for purchase, and you must use the surrounding context to decide. For a RENTAL (monthly rent, 'rent', 'lease', 'to let'): a bare figure under 1000 is thousands per month — 'Budget 35 to 40' -> budget_min 35000, budget_max 40000; 'rent 18000' is already rupees -> 18000. For a PURCHASE: a bare figure up to 60 means crores — '1-2' -> 10000000 to 20000000, '60' -> 600000000; a bare figure between 61 and 999 means lakh — 'budget 80' -> 8000000. Use ONE unit for the whole range, chosen from the larger figure: '55 to 65' is 5500000 to 6500000, never 55 crore to 65 lakh. Never read a bare number as literal rupees when it is plainly a budget: nobody is buying a house for 35 rupees.\n" +
    "3. 'X BHK' means bhk_min = bhk_max = X unless a range is given.\n" +
    "3b. Plot sizes: 'AxB' or 'A by B' site dimensions multiply to square feet ('30x40' -> 1200, '50x80' -> 4000). Convert units: 1 acre = 43560 sqft, 1 gunta = 1089 sqft, 1 cent = 435.6 sqft, 1 sq yard = 9 sqft. A single stated size ('30x40 site', '1200 sqft') means land_area_min_sqft = land_area_max_sqft = that size. Relative words with no figure ('smaller', 'lesser dimensions', 'bigger plot') stay null — do NOT invent a number.\n" +
    '4. Only extract what the CONTACT wants. Ignore details about properties they already own or sold, meeting logistics, or agent chatter.\n' +
    "5. Distinguish wanted vs rejected: 'not interested in commercial' must NOT add 'commercial' to property_categories; 'avoid Whitefield' goes to excluded_areas.\n" +
    '6. Set fields to null / empty array when genuinely not stated. Do NOT guess.\n' +
    "7. A named project/society/building (e.g. 'Purva Vantage', 'Prestige Lakeside') goes in \"projects\", NOT \"areas\". A locality/neighbourhood (e.g. 'HSR Layout', 'Sarjapur Road') goes in \"areas\".\n" +
    '8. Output MUST be valid JSON.';

  const raw = await generateJson(
    `Extract buying preferences from:\n\n"${text}"`,
    systemInstruction
  );
  const parsed = parseJsonLenient(raw);

  const propertyTypes = toStringArray(parsed.property_types)
    .map((t) => normalizePropertyType(t))
    .filter(
      (t): t is string =>
        !!t && (PROPERTY_TYPE_VALUES as readonly string[]).includes(t)
    );

  const categories = toStringArray(parsed.property_categories)
    .map((c) => c.toLowerCase())
    .filter((c): c is PropertyCategory =>
      (PROPERTY_CATEGORY_VALUES as readonly string[]).includes(c)
    );

  const listingTypes = toStringArray(parsed.listing_types).filter(
    (t): t is ListingType =>
      (LISTING_TYPE_VALUES as readonly string[]).includes(t)
  );

  return {
    property_types: [...new Set(propertyTypes)],
    property_categories: [...new Set(categories)],
    bhk_min: toNumberOrNull(parsed.bhk_min),
    bhk_max: toNumberOrNull(parsed.bhk_max),
    budget_min: toNumberOrNull(parsed.budget_min),
    budget_max: toNumberOrNull(parsed.budget_max),
    land_area_min_sqft: toNumberOrNull(parsed.land_area_min_sqft),
    land_area_max_sqft: toNumberOrNull(parsed.land_area_max_sqft),
    areas: toStringArray(parsed.areas),
    excluded_areas: toStringArray(parsed.excluded_areas),
    projects: [...new Set(toStringArray(parsed.projects))],
    min_roi: toNumberOrNull(parsed.min_roi),
    listing_types: [...new Set(listingTypes)],
    suggested_tags: normalizeSuggestedTags(
      toStringArray(parsed.suggested_tags)
    ),
  };
}

/**
 * Stable hash of the extraction source text, stored in
 * contacts.pref_source_hash so unchanged contacts are skipped.
 * (djb2 — collision risk is irrelevant here; a false "unchanged"
 * only delays re-extraction until the text changes again.)
 */
export function preferenceSourceHash(sourceText: string): string {
  let hash = 5381;
  for (let i = 0; i < sourceText.length; i++) {
    hash = ((hash << 5) + hash + sourceText.charCodeAt(i)) | 0;
  }
  return `v1:${(hash >>> 0).toString(36)}:${sourceText.length}`;
}

/**
 * Builds the canonical extraction source text for a contact so the
 * hash comparison is stable across call sites.
 */
export function buildPreferenceSourceText(
  requirements: string | null | undefined,
  notes: { note_text: string }[] | null | undefined
): string {
  const notesText = (notes || []).map((n) => n.note_text).join('\n');
  return `${(requirements || '').trim()}\n${notesText.trim()}`.trim();
}
