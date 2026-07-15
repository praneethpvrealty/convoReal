import type { Contact, Property } from '@/types';
import { normalizePropertyType } from '@/lib/property-types';

// Static geocoordinates for major Bangalore sublocalities used for proximity-based matching.
const BANGALORE_LOCALITIES_COORDS: Record<string, { lat: number; lng: number }> = {
  'jp nagar': { lat: 12.9063, lng: 77.5857 },
  'indiranagar': { lat: 12.9719, lng: 77.6412 },
  'kasturi nagar': { lat: 13.0031, lng: 77.6508 },
  'hsr layout': { lat: 12.9141, lng: 77.6411 },
  'koramangala': { lat: 12.9279, lng: 77.6271 },
  'whitefield': { lat: 12.9698, lng: 77.7500 },
  'jayanagar': { lat: 12.9308, lng: 77.5838 },
  'btm layout': { lat: 12.9166, lng: 77.6101 },
  'bellandur': { lat: 12.9272, lng: 77.6756 },
  'sarjapur': { lat: 12.8624, lng: 77.7818 },
  'hebbal': { lat: 13.0354, lng: 77.5988 },
  'yelahanka': { lat: 13.1007, lng: 77.5963 },
  'electronic city': { lat: 12.8407, lng: 77.6763 },
  'marathahalli': { lat: 12.9569, lng: 77.7011 },
  'malleshwaram': { lat: 13.0031, lng: 77.5701 },
  'rajajinagar': { lat: 12.9902, lng: 77.5536 },
  'banashankari': { lat: 12.9255, lng: 77.5468 },
  'kalyan nagar': { lat: 13.0221, lng: 77.6403 },
  'kammanahalli': { lat: 13.0093, lng: 77.6366 },
  'hennur': { lat: 13.0336, lng: 77.6288 },
  'thanisandra': { lat: 13.0547, lng: 77.6326 },
  'rt nagar': { lat: 13.0189, lng: 77.5925 },
  'sadashivanagar': { lat: 13.0068, lng: 77.5802 },
  'bannerghatta road': { lat: 12.8956, lng: 77.5984 },
  'halasur nagar': { lat: 12.9818, lng: 77.6256 },
  'halasur': { lat: 12.9818, lng: 77.6256 },
  'ulsoor': { lat: 12.9818, lng: 77.6256 },
  'banaswadi': { lat: 13.0084, lng: 77.6465 },
  'cv raman nagar': { lat: 12.9792, lng: 77.6644 },
  'kaggadasapura': { lat: 12.9821, lng: 77.6775 },
  'ramamurthy nagar': { lat: 13.0163, lng: 77.6785 },
  'kr puram': { lat: 13.0104, lng: 77.7025 },
  'mahadevapura': { lat: 12.9866, lng: 77.6975 },
  'brookefield': { lat: 12.9649, lng: 77.7180 },
  'kadugodi': { lat: 13.0044, lng: 77.7550 },
  'hoodi': { lat: 12.9919, lng: 77.7126 },
  'nagawara': { lat: 13.0339, lng: 77.6186 },
  'richmond town': { lat: 12.9634, lng: 77.6012 },
  'lavelle road': { lat: 12.9723, lng: 77.5978 },
  'cunningham road': { lat: 12.9859, lng: 77.5960 },
  'mg road': { lat: 12.9756, lng: 77.6068 },
  'brigade road': { lat: 12.9712, lng: 77.6074 },
  'frazer town': { lat: 12.9972, lng: 77.6143 },
  'benson town': { lat: 12.9989, lng: 77.5996 },
  'cox town': { lat: 12.9976, lng: 77.6267 },
  'cooke town': { lat: 12.9996, lng: 77.6214 },
  'yeswanthpur': { lat: 13.0238, lng: 77.5529 },
  'peenya': { lat: 13.0285, lng: 77.5197 },
  'dasarahalli': { lat: 13.0435, lng: 77.5126 },
  'nagasandra': { lat: 13.0483, lng: 77.5025 },
  'vijayanagar': { lat: 12.9756, lng: 77.5354 },
  'chandra layout': { lat: 12.9592, lng: 77.5256 },
  'nayandahalli': { lat: 12.9405, lng: 77.5263 },
  'rajarajeshwari nagar': { lat: 12.9234, lng: 77.5204 },
  'rr nagar': { lat: 12.9234, lng: 77.5204 },
  'kengeri': { lat: 12.9099, lng: 77.4834 },
  'uttarahalli': { lat: 12.9069, lng: 77.5521 },
  'subramanyapura': { lat: 12.8986, lng: 77.5458 },
  'kumaraswamy layout': { lat: 12.9073, lng: 77.5675 },
  'padmanabhanagar': { lat: 12.9181, lng: 77.5574 },
  'girinagar': { lat: 12.9423, lng: 77.5434 },
  'basavanagudi': { lat: 12.9417, lng: 77.5755 },
  'hanumanth nagar': { lat: 12.9419, lng: 77.5614 },
  'srinagar': { lat: 12.9442, lng: 77.5528 },
  'chamarajpet': { lat: 12.9606, lng: 77.5663 },
  'gandhi nagar': { lat: 12.9767, lng: 77.5772 },
  'majestic': { lat: 12.9767, lng: 77.5772 },
  'hosur road': { lat: 12.9165, lng: 77.6253 },
  'bommanahalli': { lat: 12.9030, lng: 77.6244 },
  'singasandra': { lat: 12.8798, lng: 77.6394 },
  'hosa road': { lat: 12.8722, lng: 77.6433 },
  'konappana agrahara': { lat: 12.8504, lng: 77.6669 },
  'jigani': { lat: 12.7844, lng: 77.6274 },
  'anekal': { lat: 12.7107, lng: 77.6980 },
  'sarjapur road': { lat: 12.9099, lng: 77.6631 },
  'kasavanahalli': { lat: 12.9079, lng: 77.6749 },
  'kaikondrahalli': { lat: 12.9135, lng: 77.6748 },
  'carmelaram': { lat: 12.9136, lng: 77.6961 },
  'gunjur': { lat: 12.9234, lng: 77.7289 },
  'varthur': { lat: 12.9406, lng: 77.7471 },
  'panathur': { lat: 12.9348, lng: 77.6986 },
  'kadubeesanahalli': { lat: 12.9388, lng: 77.6914 },
  'munnekolala': { lat: 12.9515, lng: 77.7029 },
  'kundalahalli': { lat: 12.9619, lng: 77.7121 },
  'itpl': { lat: 12.9866, lng: 77.7371 },
  'doddanekundi': { lat: 12.9715, lng: 77.6953 },
  'outer ring road': { lat: 12.9388, lng: 77.6914 },
  'orr': { lat: 12.9388, lng: 77.6914 },
};

function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Property → contact matching engine.
 *
 * Matching hierarchy (product rule): Property type → Location (if given) → Budget.
 *  - Type is a hard gate at the subtype level: an apartment seeker never
 *    matches an independent house, a residential buyer never matches
 *    commercial/industrial stock.
 *  - Location refines the rank when the contact has stated areas; a stated
 *    area that doesn't cover the property excludes the contact.
 *  - Budget is applied last: a price outside the contact's stated budget
 *    (beyond tolerance) excludes them, but budget alone never qualifies a
 *    contact — "only budget matches" is not a match.
 *
 * Preference sources, in priority order:
 *  1. Explicit fields the agent filled in (min/max budget, areas_of_interest,
 *     property_interests, min_roi).
 *  2. AI-extracted pref_* columns (migration 092, populated by
 *     /api/contacts/extract-preferences from requirements + notes).
 *  3. Light text heuristics over requirements/notes as a fallback for
 *     contacts that haven't been through extraction yet.
 */

export type MatchVerdict = 'match' | 'partial' | 'unknown' | 'mismatch';

export interface MatchDetails {
  /** 'match' = exact subtype group; 'partial' = broad-category-level match. */
  type: MatchVerdict;
  /** 'partial' = city-level only. */
  location: MatchVerdict;
  /** 'partial' = near-miss within tolerance, or "no budget constraint" flag. */
  budget: MatchVerdict;
  bhk: MatchVerdict;
  roi: MatchVerdict;
}

export interface MatchingResult {
  contact: Contact;
  score: number; // 0 to 100
  details: MatchDetails;
  /** Legacy boolean view of details, kept for existing consumers. True only for genuine matches. */
  matchedFields: {
    budget: boolean;
    area: boolean;
    interest: boolean;
    roi?: boolean;
  };
}

// ── Property type taxonomy ──────────────────────────────────────────

type SubtypeGroup =
  | 'apartment'
  | 'house'
  | 'residential-plot'
  | 'pg'
  | 'commercial-space'
  | 'commercial-plot'
  | 'industrial'
  | 'agricultural'
  | 'other';

type Category = 'residential' | 'commercial' | 'industrial' | 'agricultural' | 'plot';

const TYPE_TO_GROUP: Record<string, SubtypeGroup> = {
  'Flat/ Apartment': 'apartment',
  'Builder Floor Apartment': 'apartment',
  'Penthouse': 'apartment',
  'Studio Apartment': 'apartment',
  'Residential House': 'house',
  'Villa': 'house',
  'Farm House': 'house',
  'Residential Land/ Plot': 'residential-plot',
  'Residential PG building': 'pg',
  'PG/ Hostel': 'pg',
  'Commercial Office Space': 'commercial-space',
  'Office in IT Park/ SEZ': 'commercial-space',
  'Commercial Shop': 'commercial-space',
  'Commercial Showroom': 'commercial-space',
  'Warehouse/ Godown': 'commercial-space',
  'Commercial Land': 'commercial-plot',
  'Industrial Land': 'industrial',
  'Industrial Building': 'industrial',
  'Industrial Shed': 'industrial',
  'Agricultural Land': 'agricultural',
  'Others': 'other',
};

const GROUP_TO_CATEGORY: Record<SubtypeGroup, Category | null> = {
  'apartment': 'residential',
  'house': 'residential',
  'residential-plot': 'residential',
  'pg': 'residential',
  'commercial-space': 'commercial',
  'commercial-plot': 'commercial',
  'industrial': 'industrial',
  'agricultural': 'agricultural',
  'other': null,
};

/** Groups the broad 'plot' category covers. */
const PLOT_GROUPS: SubtypeGroup[] = ['residential-plot', 'commercial-plot', 'agricultural'];

/** Resolve a property's subtype group from its (possibly free-form) type string. */
function resolvePropertyGroup(property: Partial<Property>): SubtypeGroup | null {
  const canonical = normalizePropertyType(property.type);
  if (canonical && TYPE_TO_GROUP[canonical]) return TYPE_TO_GROUP[canonical];

  // Keyword fallback over type + title for non-canonical data
  const text = `${property.type || ''} ${property.title || ''}`.toLowerCase();
  if (/industrial/.test(text)) return 'industrial';
  if (/agricultural|farm\s*land|farmland/.test(text)) return 'agricultural';
  if (/commercial/.test(text) && /plot|land|site/.test(text)) return 'commercial-plot';
  if (/office|shop|showroom|retail|warehouse|godown|commercial/.test(text)) return 'commercial-space';
  if (/\bpg\b|hostel|paying guest/.test(text)) return 'pg';
  if (/plot|\bland\b|\bsite\b/.test(text)) return 'residential-plot';
  if (/villa|independent|row house|bungalow|\bhouse\b|farm\s*house/.test(text)) return 'house';
  if (/apartment|flat|penthouse|studio/.test(text)) return 'apartment';
  return null;
}

// ── Listing intent (Sale / Rent / JV/JD / Built to Suit) ───────────

type ListingType = 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit';
const LISTING_TYPES: ListingType[] = ['Sale', 'Rent', 'JV/JD', 'Built to Suit'];
const NICHE_LISTING_TYPES: ListingType[] = ['JV/JD', 'Built to Suit'];

function resolveListingType(property: Partial<Property>): ListingType {
  const lt = property.listing_type;
  return lt && (LISTING_TYPES as string[]).includes(lt) ? (lt as ListingType) : 'Sale';
}

/** Infers stated listing intent(s) from free text. Fallback for contacts without AI extraction. */
function inferListingTypesFromText(text: string): Set<ListingType> {
  const wanted = new Set<ListingType>();
  const add = (type: ListingType, pattern: RegExp) => {
    const m = pattern.exec(text);
    if (m && !isNegated(text, m[0])) wanted.add(type);
  };
  add('JV/JD', /\bjv\/?jd\b|joint\s*venture|joint\s*development|revenue\s*share|area\s*share/i);
  add('Built to Suit', /built[\s-]?to[\s-]?suit|\bbts\b/i);
  add('Rent', /\brent(al)?\b|to\s*let|\btenant\b|\blease\b/i);
  return wanted;
}

// ── Text heuristics (fallback for contacts without AI extraction) ──

/**
 * Helper to check if a keyword in a string is negated by a preceding negation
 * term (e.g. "not Jayanagar", "no commercial").
 */
function isNegated(text: string, keyword: string): boolean {
  const cleanKeyword = keyword.toLowerCase().trim();
  if (!cleanKeyword) return false;
  let index = text.indexOf(cleanKeyword);

  while (index !== -1) {
    const precedingText = text.substring(Math.max(0, index - 35), index).trim();
    const negationWords = ['not', 'no', 'except', 'excluding', 'exclude', 'avoid', 'dont', "don't", 'never', 'outside', 'but'];
    const negated = negationWords.some((neg) => new RegExp(`\\b${neg}\\b`, 'i').test(precedingText));
    if (negated) return true;
    index = text.indexOf(cleanKeyword, index + 1);
  }
  return false;
}

/** Extracts min and max budget bounds from unstructured requirements/notes text. */
function parseBudgetFromText(text: string): { min: number | null; max: number | null } {
  const clean = text.toLowerCase();
  let maxBudgetVal: number | null = null;
  let minBudgetVal: number | null = null;

  const unitMultiplier = (unit: string) =>
    unit.startsWith('cr') ? 10000000 : 100000;

  const maxPattern = /(?:under|below|up\s*to|max|maximum|budget\s+of|budget\s+around|budget\s+is)\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*(cr|crore|lakh|lakhs|l|cr\.)/g;
  let match;
  while ((match = maxPattern.exec(clean)) !== null) {
    maxBudgetVal = parseFloat(match[1]) * unitMultiplier(match[2]);
  }

  const minPattern = /(?:above|at\s*least|min|minimum)\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*(cr|crore|lakh|lakhs|l|cr\.)/g;
  while ((match = minPattern.exec(clean)) !== null) {
    minBudgetVal = parseFloat(match[1]) * unitMultiplier(match[2]);
  }

  return { min: minBudgetVal, max: maxBudgetVal };
}

/** Extracts a minimum expected ROI/yield percentage from free text. */
function parseRoiFromText(text: string): number | null {
  const yieldPattern = /(?:yielding|yield|roi|return)\s*(?:of|is|above|greater\s*than|>)?\s*(\d+(?:\.\d+)?)\s*%/g;
  let minRoi: number | null = null;
  let m;
  while ((m = yieldPattern.exec(text)) !== null) {
    minRoi = parseFloat(m[1]);
  }
  return minRoi;
}

/**
 * Infers wanted subtype groups / categories from free text, respecting
 * negations ("no commercial"). Used only when structured prefs are absent.
 */
function inferTypePrefsFromText(text: string): { groups: Set<SubtypeGroup>; categories: Set<Category> } {
  const groups = new Set<SubtypeGroup>();
  const categories = new Set<Category>();
  const has = (kw: string) => text.includes(kw) && !isNegated(text, kw);

  if (has('apartment') || has('flat') || has('penthouse') || has('studio')) groups.add('apartment');
  if (has('villa') || has('independent house') || has('row house') || has('bungalow')) groups.add('house');
  if (has('plot') || has('vacant land') || (has('land') && !text.includes('landmark'))) categories.add('plot');
  if (has('commercial') || has('office space') || has('shop') || has('showroom') || has('warehouse')) categories.add('commercial');
  if (has('residential')) categories.add('residential');
  if (has('industrial')) categories.add('industrial');
  if (has('agricultural') || has('farmland') || has('farm land')) categories.add('agricultural');
  return { groups, categories };
}

/** Maps a legacy property_interests entry to groups/categories. ROI-style interests return nothing (not a type constraint). */
function mapLegacyInterest(interest: string): { groups: SubtypeGroup[]; categories: Category[] } {
  const s = interest.toLowerCase().trim();
  if (!s) return { groups: [], categories: [] };

  if (s.includes('roi') || s.includes('rental') || s.includes('yield')) return { groups: [], categories: [] };
  if (s.includes('site rate') || s.includes('old building') || s.includes('demolish')) {
    // Redevelopment buyers: interested in land value — houses and plots
    return { groups: ['house'], categories: ['plot'] };
  }
  if (s.includes('plot') || s.includes('vacant land') || s === 'land') return { groups: [], categories: ['plot'] };
  if (s.includes('building')) {
    // "Vacant building" style interests span built structures
    return { groups: ['house', 'commercial-space'], categories: [] };
  }

  const canonical = normalizePropertyType(interest);
  if (canonical && TYPE_TO_GROUP[canonical]) return { groups: [TYPE_TO_GROUP[canonical]], categories: [] };

  if (s.includes('apartment') || s.includes('flat')) return { groups: ['apartment'], categories: [] };
  if (s.includes('villa') || s.includes('house')) return { groups: ['house'], categories: [] };
  if (s.includes('commercial')) return { groups: [], categories: ['commercial'] };
  if (s.includes('residential')) return { groups: [], categories: ['residential'] };
  if (s.includes('industrial')) return { groups: [], categories: ['industrial'] };
  if (s.includes('agricultural') || s.includes('farm')) return { groups: [], categories: ['agricultural'] };
  return { groups: [], categories: [] };
}

const AREA_PLACEHOLDERS = ['not specific', 'any', ''];

function cleanArea(area: string): string {
  return area.toLowerCase().replace(/\./g, '').trim();
}

// ── Main matcher ────────────────────────────────────────────────────

export function getMatchingContacts(
  property: Partial<Property>,
  contacts: Contact[]
): MatchingResult[] {
  if (!property.price && !property.location && !property.type) {
    return [];
  }

  const propertyGroup = resolvePropertyGroup(property);
  const propertyCategory = propertyGroup ? GROUP_TO_CATEGORY[propertyGroup] : null;
  const propertyListingType = resolveListingType(property);
  const price = Number(property.price || 0);
  const rentalIncome = property.rental_income ? Number(property.rental_income) : null;
  const propertyRoi = property.roi
    ? Number(property.roi)
    : price > 0 && rentalIncome !== null
      ? ((rentalIncome * 12) / price) * 100
      : null;
  // Budget comparison value switches with listing type: Sale prices against
  // `price`, Rent/Built to Suit against monthly rent, JV/JD against `price`
  // only if one was entered (JV deals are usually matched on land/share
  // terms, not a price band).
  const budgetComparisonValue =
    propertyListingType === 'Rent' || propertyListingType === 'Built to Suit'
      ? Number(property.rent_per_month || 0)
      : price;

  const propLoc = cleanArea(property.location || '');
  const propSub = cleanArea(property.sublocality || '');
  const propCity = cleanArea(property.city || '');
  const propProject = cleanArea(property.project || '');
  const propBedrooms = property.bedrooms ? Number(property.bedrooms) : null;

  const results: MatchingResult[] = [];

  for (const contact of contacts) {
    const notesText = (contact.contact_notes || []).map((n) => n.note_text).join(' ');
    const combinedText = `${contact.requirements || ''} ${notesText}`.toLowerCase();
    const hasExtraction = !!contact.pref_extracted_at;

    // ── 0. Listing intent gate (Sale / Rent / JV/JD / Built to Suit) ──
    // JV/JD and Built to Suit are niche deals: they only ever surface for
    // contacts who have explicitly stated that intent, regardless of type/
    // location/budget fit. Sale/Rent stay soft — an unstated intent doesn't
    // exclude anyone (preserves pre-existing matching behavior), but a
    // stated contrary intent (e.g. "looking to rent") does.
    const wantedListingTypes = new Set<ListingType>(
      (contact.pref_listing_types || []).filter((t): t is ListingType =>
        (LISTING_TYPES as string[]).includes(t)
      )
    );
    if (wantedListingTypes.size === 0 && !hasExtraction) {
      inferListingTypesFromText(combinedText).forEach((t) => wantedListingTypes.add(t));
    }
    const isNicheListing = NICHE_LISTING_TYPES.includes(propertyListingType);
    if (wantedListingTypes.size > 0) {
      if (!wantedListingTypes.has(propertyListingType)) continue;
    } else if (isNicheListing) {
      continue;
    }

    // ── 1. Property type gate ─────────────────────────────────────
    const wantedGroups = new Set<SubtypeGroup>();
    const wantedCategories = new Set<Category>();

    for (const t of contact.pref_property_types || []) {
      const g = TYPE_TO_GROUP[t] || (normalizePropertyType(t) ? TYPE_TO_GROUP[normalizePropertyType(t)!] : undefined);
      if (g) wantedGroups.add(g);
    }
    for (const c of contact.pref_property_categories || []) {
      if (['residential', 'commercial', 'industrial', 'agricultural', 'plot'].includes(c)) {
        wantedCategories.add(c as Category);
      }
    }
    for (const interest of contact.property_interests || []) {
      const mapped = mapLegacyInterest(interest);
      mapped.groups.forEach((g) => wantedGroups.add(g));
      mapped.categories.forEach((c) => wantedCategories.add(c));
    }
    // Text fallback only for contacts that haven't been AI-extracted yet
    if (!hasExtraction && wantedGroups.size === 0 && wantedCategories.size === 0) {
      const inferred = inferTypePrefsFromText(combinedText);
      inferred.groups.forEach((g) => wantedGroups.add(g));
      inferred.categories.forEach((c) => wantedCategories.add(c));
    }

    const hasTypePrefs = wantedGroups.size > 0 || wantedCategories.size > 0;

    let typeVerdict: MatchVerdict = 'unknown';
    if (hasTypePrefs) {
      if (propertyGroup && wantedGroups.has(propertyGroup)) {
        typeVerdict = 'match';
      } else if (
        propertyCategory &&
        wantedCategories.has(propertyCategory) &&
        // A stated subtype in the same category keeps the gate strict:
        // an apartment seeker with no other residential interests must
        // not match a house just because both are "residential".
        ![...wantedGroups].some((g) => GROUP_TO_CATEGORY[g] === propertyCategory)
      ) {
        typeVerdict = 'partial';
      } else if (propertyGroup && wantedCategories.has('plot') && PLOT_GROUPS.includes(propertyGroup)) {
        typeVerdict = 'partial';
      } else {
        typeVerdict = 'mismatch';
      }
    }

    // Explicit category negation in text overrides ("no commercial please")
    if (typeVerdict !== 'mismatch' && propertyCategory && combinedText && isNegated(combinedText, propertyCategory)) {
      typeVerdict = 'mismatch';
    }

    if (typeVerdict === 'mismatch') continue;

    // ── 2. ROI expectation ────────────────────────────────────────
    const minExpectedRoi =
      contact.min_roi != null && Number(contact.min_roi) > 0
        ? Number(contact.min_roi)
        : contact.pref_min_roi != null && Number(contact.pref_min_roi) > 0
          ? Number(contact.pref_min_roi)
          : !hasExtraction
            ? parseRoiFromText(combinedText)
            : null;

    let roiVerdict: MatchVerdict = 'unknown';
    if (minExpectedRoi !== null) {
      // ROI for lands/plots cannot be matched and should be ignored
      const isLand = propertyGroup && PLOT_GROUPS.includes(propertyGroup);
      if (isLand) {
        roiVerdict = 'unknown';
      } else {
        roiVerdict = propertyRoi !== null && propertyRoi >= minExpectedRoi ? 'match' : 'mismatch';
      }
    }
    if (roiVerdict === 'mismatch') continue;

    // ── 3. Location ───────────────────────────────────────────────
    const explicitAreas = (contact.areas_of_interest || [])
      .map(cleanArea)
      .filter((a) => !AREA_PLACEHOLDERS.includes(a));

    // Google-resolved coordinates saved with the contact take precedence over
    // the static locality table, so areas outside it still radius-match.
    const contactAreaCoords: Record<string, { lat: number; lng: number }> = {};
    for (const g of contact.areas_of_interest_geo || []) {
      if (g?.name && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
        contactAreaCoords[cleanArea(g.name)] = { lat: g.lat, lng: g.lng };
      }
    }
    const aiAreas = (contact.pref_areas || []).map(cleanArea).filter(Boolean);
    const wantedAreas = [...new Set([...explicitAreas, ...aiAreas])].filter(
      (a) => !isNegated(combinedText, a)
    );
    const excludedAreas = (contact.pref_excluded_areas || []).map(cleanArea).filter(Boolean);

    const areaHitsProperty = (area: string) =>
      !!area &&
      (propLoc.includes(area) || propSub.includes(area) || propProject.includes(area));

    // A negated/excluded locality covering this property disqualifies the contact
    const negativeHit =
      excludedAreas.some(areaHitsProperty) ||
      (propSub && isNegated(combinedText, propSub)) ||
      (propProject && isNegated(combinedText, propProject));
    if (negativeHit) continue;

    let locationVerdict: MatchVerdict = 'unknown';
    if (wantedAreas.length > 0) {
      // 3.1 Proximity-based matching if coordinates are available
      const pLat = property.latitude ? Number(property.latitude) : (property.sublocality ? BANGALORE_LOCALITIES_COORDS[cleanArea(property.sublocality)]?.lat : null);
      const pLng = property.longitude ? Number(property.longitude) : (property.sublocality ? BANGALORE_LOCALITIES_COORDS[cleanArea(property.sublocality)]?.lng : null);
      
      let checkedProximity = false;
      let hasProximityMatch = false;
      let hasProximityMismatch = false;

      if (pLat !== null && pLng !== null) {
        const maxAllowedDistance = contact.strict_area_match ? 5 : 20;
        
        for (const area of wantedAreas) {
          const areaCoords = contactAreaCoords[area] ?? BANGALORE_LOCALITIES_COORDS[area];
          if (areaCoords) {
            checkedProximity = true;
            const dist = calculateHaversineDistance(pLat, pLng, areaCoords.lat, areaCoords.lng);
            if (dist <= maxAllowedDistance) {
              hasProximityMatch = true;
              break;
            } else {
              hasProximityMismatch = true;
            }
          }
        }
      }

      if (checkedProximity) {
        if (hasProximityMatch) {
          locationVerdict = 'match';
        } else if (hasProximityMismatch) {
          locationVerdict = 'mismatch';
        }
      } else {
        // 3.2 Fallback to traditional substring matching
        if (wantedAreas.some(areaHitsProperty)) {
          locationVerdict = 'match';
        } else if (propCity && wantedAreas.some((a) => propCity.includes(a))) {
          locationVerdict = 'partial';
        } else {
          locationVerdict = 'mismatch';
        }
      }
    }
    // Direct mention of the property's locality/project in notes counts as a match
    if (locationVerdict !== 'match' && combinedText) {
      if (
        (propSub && propSub.length > 2 && combinedText.includes(propSub)) ||
        (propProject && propProject.length > 2 && combinedText.includes(propProject))
      ) {
        locationVerdict = 'match';
      }
    }

    if (locationVerdict === 'mismatch') {
      // Yield-focused commercial purchases are location-agnostic
      const yieldBypass =
        minExpectedRoi !== null && propertyCategory === 'commercial' && roiVerdict === 'match';
      const textBypass =
        combinedText.includes('any location') ||
        combinedText.includes('no location preference') ||
        combinedText.includes('location agnostic') ||
        combinedText.includes('yield focused') ||
        combinedText.includes('roi focused');
      if (yieldBypass || textBypass) {
        locationVerdict = 'unknown';
      } else {
        continue;
      }
    }

    // ── 4. Budget (applied last) ──────────────────────────────────
    const explicitMin = contact.min_budget != null && Number(contact.min_budget) > 0 ? Number(contact.min_budget) : null;
    const explicitMax = contact.max_budget != null && Number(contact.max_budget) > 0 ? Number(contact.max_budget) : null;
    let budgetMin = explicitMin ?? (contact.pref_budget_min != null ? Number(contact.pref_budget_min) : null);
    let budgetMax = explicitMax ?? (contact.pref_budget_max != null ? Number(contact.pref_budget_max) : null);
    if (budgetMin === null && budgetMax === null && !hasExtraction) {
      const parsed = parseBudgetFromText(combinedText);
      budgetMin = parsed.min;
      budgetMax = parsed.max;
    }

    const BUDGET_TOLERANCE_MIN = 0.2; // Allowing 20% gap/tolerance on lower side
    const BUDGET_TOLERANCE_MAX = 0.1; // Keeping strict 10% gap/tolerance on upper side
    let budgetVerdict: MatchVerdict = 'unknown';
    if (contact.no_budget) {
      budgetVerdict = 'partial'; // flexible — no constraint stated on purpose
    } else if ((budgetMin !== null || budgetMax !== null) && budgetComparisonValue > 0) {
      const minOk = budgetMin === null || budgetComparisonValue >= budgetMin;
      const maxOk = budgetMax === null || budgetComparisonValue <= budgetMax;
      if (minOk && maxOk) {
        budgetVerdict = 'match';
      } else {
        const nearMin = budgetMin === null || budgetComparisonValue >= budgetMin * (1 - BUDGET_TOLERANCE_MIN);
        const nearMax = budgetMax === null || budgetComparisonValue <= budgetMax * (1 + BUDGET_TOLERANCE_MAX);
        budgetVerdict = nearMin && nearMax ? 'partial' : 'mismatch';
      }
    }
    if (budgetVerdict === 'mismatch') continue;

    // ── 5. BHK fit ────────────────────────────────────────────────
    const bhkMin = contact.pref_bhk_min != null ? Number(contact.pref_bhk_min) : null;
    const bhkMax = contact.pref_bhk_max != null ? Number(contact.pref_bhk_max) : null;
    let bhkVerdict: MatchVerdict = 'unknown';
    let bhkDistance = 0;
    if (propBedrooms !== null && (bhkMin !== null || bhkMax !== null)) {
      const lo = bhkMin ?? bhkMax!;
      const hi = bhkMax ?? bhkMin!;
      if (propBedrooms >= lo && propBedrooms <= hi) {
        bhkVerdict = 'match';
      } else {
        bhkDistance = propBedrooms < lo ? lo - propBedrooms : propBedrooms - hi;
        bhkVerdict = 'mismatch'; // penalized in score, not excluded
      }
    }

    // ── Inclusion rule ────────────────────────────────────────────
    // Budget alone never qualifies: require a type match, or — when the
    // contact has no type preference at all — a location or explicit-ROI match.
    const qualifies =
      typeVerdict === 'match' ||
      typeVerdict === 'partial' ||
      (!hasTypePrefs && (locationVerdict === 'match' || roiVerdict === 'match'));
    if (!qualifies) continue;

    // ── Scoring ───────────────────────────────────────────────────
    let score = 0;
    if (typeVerdict === 'match') score += 45;
    else if (typeVerdict === 'partial') score += 35;

    if (locationVerdict === 'match') score += 30;
    else if (locationVerdict === 'partial') score += 12;

    if (budgetVerdict === 'match') score += 20;
    else if (budgetVerdict === 'partial') score += 8;

    if (bhkVerdict === 'match') score += 10;
    else if (bhkVerdict === 'mismatch') score -= bhkDistance >= 2 ? 15 : 5;

    if (roiVerdict === 'match') score += 5;

    score = Math.max(0, Math.min(100, score));

    results.push({
      contact,
      score,
      details: {
        type: typeVerdict,
        location: locationVerdict,
        budget: budgetVerdict,
        bhk: bhkVerdict,
        roi: roiVerdict,
      },
      matchedFields: {
        budget: budgetVerdict === 'match',
        area: locationVerdict === 'match',
        interest: typeVerdict === 'match' || typeVerdict === 'partial',
        roi: roiVerdict === 'match',
      },
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
