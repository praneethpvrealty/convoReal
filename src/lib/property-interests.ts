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

/**
 * The subset offered inside the WhatsApp preference Flow. Meta caps how
 * many items a CheckboxGroup data-source may carry, so this list stays
 * at the eleven it has always shipped rather than growing with the
 * in-app vocabulary below. Changing it means republishing the Flow to
 * Meta for every account; adding an in-app option does not.
 */
export const PROPERTY_INTEREST_FLOW_IDS = [
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

/**
 * Everything the in-app pickers offer: the Flow vocabulary above plus
 * the remaining canonical property types from PROPERTY_TYPE_VALUES, so
 * an agent can record interest in any type the inventory can hold.
 * These are canonical strings, so mapLegacyInterest() resolves them
 * through normalizePropertyType() rather than its phrase heuristics.
 */
export const PROPERTY_INTEREST_OPTIONS = [
  ...PROPERTY_INTEREST_FLOW_IDS,
  'Builder Floor Apartment',
  'Penthouse',
  'Studio Apartment',
  'Residential Plot',
  'Residential Land',
  'Residential PG building',
  'PG/ Hostel',
  'Farm House',
  'Office in IT Park/ SEZ',
  'Commercial Showroom',
  'Commercial Building',
  'Commercial Land',
  'Warehouse/ Godown',
  'Industrial Land',
  'Industrial Building',
  'Industrial Shed',
] as const;

/** Labels that exceed Meta's 30-char CheckboxGroup item limit, shortened. */
export const PROPERTY_INTEREST_SHORT_TITLES: Record<string, string> = {
  'Rental building with some ROI': 'Rental building with ROI',
  'Old building selling at site rate': 'Old building at site rate',
};
