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

/**
 * The shape of an AI preference extraction, apart from the extraction
 * itself.
 *
 * Kept in its own module because the type is read where the extractor
 * is not: src/lib/requirements/profiles.ts needs it, matching.ts needs
 * profiles, and the mobile app type-checks matching through @shared/.
 * Importing the type from preference-extraction.ts pulled Gemini, the
 * notification dispatcher and 18 WhatsApp modules into that program
 * for a type that names none of them. preference-extraction.ts
 * re-exports both, so every other caller is unaffected.
 */
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
  requires_tenanted: boolean;
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
  requires_tenanted: false,
  listing_types: [],
  suggested_tags: [],
};
