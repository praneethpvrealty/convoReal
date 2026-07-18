import { generateJson } from './gemini';
import { normalizePropertyType, PROPERTY_TYPE_VALUES } from '@/lib/property-types';

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

export const LISTING_TYPE_VALUES = ['Sale', 'Rent', 'JV/JD', 'Built to Suit'] as const;

export type ListingType = (typeof LISTING_TYPE_VALUES)[number];

export interface ExtractedPreferences {
  property_types: string[];
  property_categories: PropertyCategory[];
  bhk_min: number | null;
  bhk_max: number | null;
  budget_min: number | null;
  budget_max: number | null;
  areas: string[];
  excluded_areas: string[];
  min_roi: number | null;
  listing_types: ListingType[];
  /** Short buyer-profile labels to SUGGEST as CRM tags (never
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
  areas: [],
  excluded_areas: [],
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
    cleaned = cleaned.replace(/^```(json)?/, '').replace(/```$/, '').trim();
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
  if (typeof val === 'string' && val.trim() && !isNaN(Number(val))) return Number(val);
  return null;
}

/**
 * Extracts structured real estate preferences from a contact's free-text
 * requirements and notes. Throws on API/parse failure — callers decide
 * whether to retry or leave the previous extraction in place.
 */
export async function extractContactPreferences(sourceText: string): Promise<ExtractedPreferences> {
  const text = sourceText.trim();
  if (!text) return EMPTY_PREFERENCES;

  const systemInstruction =
    'You are an expert real estate CRM analyst for the Indian market. You are given the free-text requirements and notes saved against a BUYER contact. ' +
    'Extract their property-buying preferences as a JSON object with this exact structure:\n' +
    '{\n' +
    `  "property_types": Array of SPECIFIC property types the contact wants, each exactly one of: ${PROPERTY_TYPE_VALUES.map((v) => `'${v}'`).join(', ')}. Empty array if no specific type is stated.,\n` +
    '  "property_categories": Array of BROAD categories the contact wants, each exactly one of: \'residential\', \'commercial\', \'industrial\', \'agricultural\', \'plot\'. Fill this when the text states a category (e.g. "looking for commercial") — also derive it from any specific types you listed (e.g. \'Flat/ Apartment\' implies \'residential\'). Empty array if nothing about type/category is stated.,\n' +
    '  "bhk_min": Minimum bedroom count wanted (numeric, e.g. "2 or 3 BHK" -> 2, "3BHK" -> 3) or null,\n' +
    '  "bhk_max": Maximum bedroom count wanted (e.g. "2 or 3 BHK" -> 3, "3BHK" -> 3) or null,\n' +
    '  "budget_min": Minimum budget in INR (e.g. "above 1 Cr" -> 10000000, "80L to 1.2Cr" -> 8000000) or null,\n' +
    '  "budget_max": Maximum budget in INR (e.g. "under 1.2 Cr" -> 12000000, "budget 90 lakhs" -> 9000000) or null,\n' +
    '  "areas": Array of localities/neighbourhoods/cities the contact WANTS (e.g. ["HSR Layout", "Koramangala"]). Empty array if none or "any location".,\n' +
    '  "excluded_areas": Array of localities the contact explicitly does NOT want (e.g. "not Jayanagar" -> ["Jayanagar"]). Empty array if none.,\n' +
    '  "min_roi": Minimum rental yield / ROI percentage wanted (e.g. "yield above 4%" -> 4) or null,\n' +
    `  "listing_types": Array of deal type(s) the contact wants, each exactly one of: ${LISTING_TYPE_VALUES.map((v) => `'${v}'`).join(', ')}. 'Rent'/'tenant'/'to let' -> 'Rent'. 'Joint venture'/'joint development'/'JV'/'JD'/'revenue share'/'landowner looking for a builder' -> 'JV/JD'. 'Built to suit'/'BTS'/'lease to occupier' -> 'Built to Suit'. Leave empty if the contact is a plain buyer with no stated deal-type preference — do NOT assume 'Sale' by default.,\n` +
    '  "suggested_tags": Array of at most 3 SHORT, reusable buyer-profile labels an agent might tag this contact with, Title Case, each 2-24 chars (e.g. "Investor", "End User", "NRI", "First-Time Buyer", "Rental Income", "Urgent"). Only include labels clearly supported by the text (e.g. "for investment purposes" -> "Investor"; "will let out floors" -> "Rental Income"). Do NOT include locations, budgets, BHK, or property types — those are captured by the other fields. Empty array when nothing profile-like is stated.\n' +
    '}\n\n' +
    'Rules:\n' +
    "1. Convert Indian number formats: 'Crore'/'Cr' = 10000000, 'Lakh'/'L' = 100000, 'k' = 1000. '1.2cr' -> 12000000, '80L' -> 8000000, '₹90 lakh' -> 9000000.\n" +
    "2. A single budget figure with no qualifier (e.g. 'budget 1 Cr') means budget_max, leave budget_min null. '±'/'around'/'approx' also maps to budget_max.\n" +
    "3. 'X BHK' means bhk_min = bhk_max = X unless a range is given.\n" +
    "4. Only extract what the CONTACT wants. Ignore details about properties they already own or sold, meeting logistics, or agent chatter.\n" +
    "5. Distinguish wanted vs rejected: 'not interested in commercial' must NOT add 'commercial' to property_categories; 'avoid Whitefield' goes to excluded_areas.\n" +
    "6. Set fields to null / empty array when genuinely not stated. Do NOT guess.\n" +
    '7. Output MUST be valid JSON.';

  const raw = await generateJson(`Extract buying preferences from:\n\n"${text}"`, systemInstruction);
  const parsed = parseJsonLenient(raw);

  const propertyTypes = toStringArray(parsed.property_types)
    .map((t) => normalizePropertyType(t))
    .filter((t): t is string => !!t && (PROPERTY_TYPE_VALUES as readonly string[]).includes(t));

  const categories = toStringArray(parsed.property_categories)
    .map((c) => c.toLowerCase())
    .filter((c): c is PropertyCategory =>
      (PROPERTY_CATEGORY_VALUES as readonly string[]).includes(c)
    );

  const listingTypes = toStringArray(parsed.listing_types)
    .filter((t): t is ListingType => (LISTING_TYPE_VALUES as readonly string[]).includes(t));

  return {
    property_types: [...new Set(propertyTypes)],
    property_categories: [...new Set(categories)],
    bhk_min: toNumberOrNull(parsed.bhk_min),
    bhk_max: toNumberOrNull(parsed.bhk_max),
    budget_min: toNumberOrNull(parsed.budget_min),
    budget_max: toNumberOrNull(parsed.budget_max),
    areas: toStringArray(parsed.areas),
    excluded_areas: toStringArray(parsed.excluded_areas),
    min_roi: toNumberOrNull(parsed.min_roi),
    listing_types: [...new Set(listingTypes)],
    suggested_tags: normalizeSuggestedTags(toStringArray(parsed.suggested_tags)),
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
