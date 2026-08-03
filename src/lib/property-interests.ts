/**
 * The property-interest vocabulary a contact can be tagged with, shared
 * by every surface that asks the question: the contact form, the
 * contact detail preferences panel, the WhatsApp preference flow and
 * the buyer portal (which derives its allow-list from the flow).
 *
 * Values are matched by mapLegacyInterest() in src/lib/matching.ts, so
 * every entry must either be a canonical PROPERTY_TYPE_VALUES string or
 * one of the legacy investor phrasings that function recognises.
 * Residential/commercial types lead — most buyers want a home, and
 * until they were listed the only way to record "wants a flat" was
 * prose that AI extraction had to catch.
 */

export const PROPERTY_INTEREST_OPTIONS = [
  'Flat/ Apartment',
  'Villa',
  'Residential House',
  'Residential Land/ Plot',
  'Commercial Office Space',
  'Commercial Shop',
  'Agricultural Land',
  'Vacant plot',
  'Vacant building',
  'Rental building with some ROI',
  'Old building selling at site rate',
] as const;

/** Labels that exceed Meta's 30-char CheckboxGroup item limit, shortened. */
export const PROPERTY_INTEREST_SHORT_TITLES: Record<string, string> = {
  'Rental building with some ROI': 'Rental building with ROI',
  'Old building selling at site rate': 'Old building at site rate',
};
