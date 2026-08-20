import type { Contact, Property } from '@/types';
import type { ContactParty } from '@/lib/contacts/parties';
import { normalizePropertyType } from '@/lib/property-types';
import { textContainsProject } from '@/lib/project-match';
import { toSquareFeet } from '@/lib/area-units';
import {
  activeRequirementProfiles,
  contactForRequirementProfile,
  resolveRequirementSource,
} from '@/lib/requirements/profiles';

// Static geocoordinates for major Bangalore sublocalities used for proximity-based matching.
const BANGALORE_LOCALITIES_COORDS: Record<
  string,
  { lat: number; lng: number }
> = {
  'jp nagar': { lat: 12.9063, lng: 77.5857 },
  indiranagar: { lat: 12.9719, lng: 77.6412 },
  'kasturi nagar': { lat: 13.0031, lng: 77.6508 },
  'hsr layout': { lat: 12.9141, lng: 77.6411 },
  koramangala: { lat: 12.9279, lng: 77.6271 },
  whitefield: { lat: 12.9698, lng: 77.75 },
  jayanagar: { lat: 12.9308, lng: 77.5838 },
  'btm layout': { lat: 12.9166, lng: 77.6101 },
  bilekahalli: { lat: 12.8934, lng: 77.6102 },
  'vijaya bank layout': { lat: 12.8916, lng: 77.6098 },
  'vijay bank layout': { lat: 12.8916, lng: 77.6098 },
  bellandur: { lat: 12.9272, lng: 77.6756 },
  sarjapur: { lat: 12.8624, lng: 77.7818 },
  hebbal: { lat: 13.0354, lng: 77.5988 },
  yelahanka: { lat: 13.1007, lng: 77.5963 },
  'electronic city': { lat: 12.8407, lng: 77.6763 },
  marathahalli: { lat: 12.9569, lng: 77.7011 },
  malleshwaram: { lat: 13.0031, lng: 77.5701 },
  rajajinagar: { lat: 12.9902, lng: 77.5536 },
  banashankari: { lat: 12.9255, lng: 77.5468 },
  'kalyan nagar': { lat: 13.0221, lng: 77.6403 },
  kammanahalli: { lat: 13.0093, lng: 77.6366 },
  hennur: { lat: 13.0336, lng: 77.6288 },
  thanisandra: { lat: 13.0547, lng: 77.6326 },
  'rt nagar': { lat: 13.0189, lng: 77.5925 },
  sadashivanagar: { lat: 13.0068, lng: 77.5802 },
  'bannerghatta road': { lat: 12.8956, lng: 77.5984 },
  'halasur nagar': { lat: 12.9818, lng: 77.6256 },
  halasur: { lat: 12.9818, lng: 77.6256 },
  ulsoor: { lat: 12.9818, lng: 77.6256 },
  banaswadi: { lat: 13.0084, lng: 77.6465 },
  'cv raman nagar': { lat: 12.9792, lng: 77.6644 },
  kaggadasapura: { lat: 12.9821, lng: 77.6775 },
  'ramamurthy nagar': { lat: 13.0163, lng: 77.6785 },
  'kr puram': { lat: 13.0104, lng: 77.7025 },
  mahadevapura: { lat: 12.9866, lng: 77.6975 },
  brookefield: { lat: 12.9649, lng: 77.718 },
  kadugodi: { lat: 13.0044, lng: 77.755 },
  hoodi: { lat: 12.9919, lng: 77.7126 },
  nagawara: { lat: 13.0339, lng: 77.6186 },
  'richmond town': { lat: 12.9634, lng: 77.6012 },
  'lavelle road': { lat: 12.9723, lng: 77.5978 },
  'cunningham road': { lat: 12.9859, lng: 77.596 },
  'mg road': { lat: 12.9756, lng: 77.6068 },
  'brigade road': { lat: 12.9712, lng: 77.6074 },
  'frazer town': { lat: 12.9972, lng: 77.6143 },
  'benson town': { lat: 12.9989, lng: 77.5996 },
  'cox town': { lat: 12.9976, lng: 77.6267 },
  'cooke town': { lat: 12.9996, lng: 77.6214 },
  yeswanthpur: { lat: 13.0238, lng: 77.5529 },
  peenya: { lat: 13.0285, lng: 77.5197 },
  dasarahalli: { lat: 13.0435, lng: 77.5126 },
  nagasandra: { lat: 13.0483, lng: 77.5025 },
  vijayanagar: { lat: 12.9756, lng: 77.5354 },
  'chandra layout': { lat: 12.9592, lng: 77.5256 },
  nayandahalli: { lat: 12.9405, lng: 77.5263 },
  'rajarajeshwari nagar': { lat: 12.9234, lng: 77.5204 },
  'rr nagar': { lat: 12.9234, lng: 77.5204 },
  kengeri: { lat: 12.9099, lng: 77.4834 },
  uttarahalli: { lat: 12.9069, lng: 77.5521 },
  subramanyapura: { lat: 12.8986, lng: 77.5458 },
  'kumaraswamy layout': { lat: 12.9073, lng: 77.5675 },
  padmanabhanagar: { lat: 12.9181, lng: 77.5574 },
  girinagar: { lat: 12.9423, lng: 77.5434 },
  basavanagudi: { lat: 12.9417, lng: 77.5755 },
  'hanumanth nagar': { lat: 12.9419, lng: 77.5614 },
  srinagar: { lat: 12.9442, lng: 77.5528 },
  chamarajpet: { lat: 12.9606, lng: 77.5663 },
  'gandhi nagar': { lat: 12.9767, lng: 77.5772 },
  majestic: { lat: 12.9767, lng: 77.5772 },
  'hosur road': { lat: 12.9165, lng: 77.6253 },
  bommanahalli: { lat: 12.903, lng: 77.6244 },
  singasandra: { lat: 12.8798, lng: 77.6394 },
  'hosa road': { lat: 12.8722, lng: 77.6433 },
  'konappana agrahara': { lat: 12.8504, lng: 77.6669 },
  jigani: { lat: 12.7844, lng: 77.6274 },
  anekal: { lat: 12.7107, lng: 77.698 },
  'sarjapur road': { lat: 12.9099, lng: 77.6631 },
  kasavanahalli: { lat: 12.9079, lng: 77.6749 },
  kaikondrahalli: { lat: 12.9135, lng: 77.6748 },
  carmelaram: { lat: 12.9136, lng: 77.6961 },
  gunjur: { lat: 12.9234, lng: 77.7289 },
  varthur: { lat: 12.9406, lng: 77.7471 },
  panathur: { lat: 12.9348, lng: 77.6986 },
  kadubeesanahalli: { lat: 12.9388, lng: 77.6914 },
  munnekolala: { lat: 12.9515, lng: 77.7029 },
  kundalahalli: { lat: 12.9619, lng: 77.7121 },
  itpl: { lat: 12.9866, lng: 77.7371 },
  doddanekundi: { lat: 12.9715, lng: 77.6953 },
  'outer ring road': { lat: 12.9388, lng: 77.6914 },
  orr: { lat: 12.9388, lng: 77.6914 },
};

function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Property → contact matching engine.
 *
 * A named-project match (the property's project/title/tag is one the contact
 * listed in projects_of_interest or pref_projects) short-circuits the
 * hierarchy: it qualifies the contact, satisfies location, survives a
 * type/excluded-area mismatch, and scores above a generic locality hit —
 * a buyer naming a project is the strongest intent signal available.
 * With strict_project_match set, the same list inverts into a gate:
 * nothing outside those projects matches at all.
 *
 * A parked requirement (contacts.requirement_active = false) is skipped
 * outright, ahead of every gate below — it reaches no Radar event, no
 * buyer feed, no digest and no share.
 *
 * Matching hierarchy (product rule): Property type → Location (if given) → Budget.
 *  - Type is a hard gate at the subtype level: an apartment seeker never
 *    matches an independent house, a residential buyer never matches
 *    commercial/industrial stock.
 *  - Location refines the rank when the contact has stated areas; a stated
 *    area that doesn't cover the property excludes the contact, unless one
 *    of the stated areas is a placeholder ("any location") that opens it.
 *  - Budget is applied last: a price outside the contact's stated budget
 *    (beyond tolerance) excludes them, but budget alone never qualifies a
 *    contact — "only budget matches" is not a match. A stated max with no
 *    min still implies a floor at half the max — a ₹20 Cr buyer is not
 *    shopping at ₹4 Cr — so far-cheaper stock excludes too; stating an
 *    explicit min is how an agent widens that band on purpose. Explicit
 *    ceilings ("under X" phrasing, entry-band maxima, sale budgets read
 *    against rent) keep their old floor-less reading — see the budget
 *    step for the exact carve-outs.
 *
 * Preference sources, in priority order:
 *  1. Explicit fields the agent filled in (min/max budget, areas_of_interest,
 *     projects_of_interest, property_interests, min_roi).
 *  2. AI-extracted pref_* columns (migration 092, populated by
 *     /api/contacts/extract-preferences from requirements + notes).
 *  3. Light text heuristics over requirements/notes as a fallback for
 *     contacts that haven't been through extraction yet.
 *  4. For listing intent only: the Sale/Rent mix of the listings the
 *     contact enquired about (contact.inquired_listing_types), so a
 *     lead who has only ever asked about sale stock is not alerted
 *     about leases.
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
  /** Plot/built-up size against the contact's stated band (canonical
   *  sqft). 'partial' = within 20% of a bound; a further miss excludes,
   *  like budget — "lesser dimensions" must actually drop the plot the
   *  lead just declined. */
  size?: MatchVerdict;
  /** 'match' = the property's project/title/tag is one the contact named
   *  in projects_of_interest/pref_projects — a decisive, high-intent
   *  signal. */
  project?: MatchVerdict;
}

export interface MatchingResult {
  contact: Contact;
  score: number; // 0 to 100
  details: MatchDetails;
  /** Set only when the caller passed a party index and this contact
   *  buys with others — a couple, or colleagues from one firm. The
   *  result then stands for the whole party. */
  party?: { id: string; name: string | null } | null;
  /** The other members this result absorbed. Empty unless `party` is
   *  set. Surfaces name them so a match list reads as one deal. */
  alsoMatched?: Contact[];
  /** Legacy boolean view of details, kept for existing consumers. True only for genuine matches. */
  matchedFields: {
    budget: boolean;
    area: boolean;
    interest: boolean;
    roi?: boolean;
    /** The property is in a project the contact explicitly named. */
    project?: boolean;
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

type Category =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'agricultural'
  | 'plot';

const TYPE_TO_GROUP: Record<string, SubtypeGroup> = {
  'Flat/ Apartment': 'apartment',
  'Builder Floor Apartment': 'apartment',
  Penthouse: 'apartment',
  'Studio Apartment': 'apartment',
  'Residential House': 'house',
  Villa: 'house',
  'Farm House': 'house',
  'Residential Land/ Plot': 'residential-plot',
  'Residential PG building': 'pg',
  'PG/ Hostel': 'pg',
  'Commercial Office Space': 'commercial-space',
  'Office in IT Park/ SEZ': 'commercial-space',
  'Commercial Shop': 'commercial-space',
  'Commercial Showroom': 'commercial-space',
  'Commercial Building': 'commercial-space',
  'Warehouse/ Godown': 'commercial-space',
  'Commercial Land': 'commercial-plot',
  'Industrial Land': 'industrial',
  'Industrial Building': 'industrial',
  'Industrial Shed': 'industrial',
  'Agricultural Land': 'agricultural',
  Others: 'other',
};

const GROUP_TO_CATEGORY: Record<SubtypeGroup, Category | null> = {
  apartment: 'residential',
  house: 'residential',
  'residential-plot': 'residential',
  pg: 'residential',
  'commercial-space': 'commercial',
  'commercial-plot': 'commercial',
  industrial: 'industrial',
  agricultural: 'agricultural',
  other: null,
};

/** Groups the broad 'plot' category covers. */
const PLOT_GROUPS: SubtypeGroup[] = [
  'residential-plot',
  'commercial-plot',
  'agricultural',
];

/** Resolve a property's subtype group from its (possibly free-form) type string. */
function resolvePropertyGroup(
  property: Partial<Property>
): SubtypeGroup | null {
  const canonical = normalizePropertyType(property.type);
  if (canonical && TYPE_TO_GROUP[canonical]) return TYPE_TO_GROUP[canonical];

  // Keyword fallback over type + title for non-canonical data
  const text = `${property.type || ''} ${property.title || ''}`.toLowerCase();
  if (/industrial/.test(text)) return 'industrial';
  if (/agricultural|farm\s*land|farmland/.test(text)) return 'agricultural';
  if (/commercial/.test(text) && /plot|land|site/.test(text))
    return 'commercial-plot';
  if (/office|shop|showroom|retail|warehouse|godown|commercial/.test(text))
    return 'commercial-space';
  if (/\bpg\b|hostel|paying guest/.test(text)) return 'pg';
  if (/plot|\bland\b|\bsite\b/.test(text)) return 'residential-plot';
  if (/villa|independent|row house|bungalow|\bhouse\b|farm\s*house/.test(text))
    return 'house';
  if (/apartment|flat|penthouse|studio/.test(text)) return 'apartment';
  return null;
}

// ── Listing intent (Sale / Rent / JV/JD / Built to Suit) ───────────

type ListingType = 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit';
const LISTING_TYPES: ListingType[] = ['Sale', 'Rent', 'JV/JD', 'Built to Suit'];
const NICHE_LISTING_TYPES: ListingType[] = ['JV/JD', 'Built to Suit'];

function resolveListingType(property: Partial<Property>): ListingType {
  const lt = property.listing_type;
  return lt && (LISTING_TYPES as string[]).includes(lt)
    ? (lt as ListingType)
    : 'Sale';
}

/** Infers stated listing intent(s) from free text. Fallback for contacts without AI extraction. */
function inferListingTypesFromText(text: string): Set<ListingType> {
  const wanted = new Set<ListingType>();
  const add = (type: ListingType, pattern: RegExp) => {
    const m = pattern.exec(text);
    if (m && !isNegated(text, m[0])) wanted.add(type);
  };
  add(
    'JV/JD',
    /\bjv\/?jd\b|joint\s*venture|joint\s*development|revenue\s*share|area\s*share/i
  );
  add('Built to Suit', /built[\s-]?to[\s-]?suit|\bbts\b/i);
  add('Rent', /\brent(al)?\b|to\s*let|\btenant\b|\blease\b/i);
  return wanted;
}

/**
 * Intent read from what the contact actually enquired about. A lead who
 * has only ever asked about listings for sale is shopping to buy, and a
 * lease landing in their alerts is noise — so their enquiry history
 * stands in for an intent they never stated in words.
 *
 * Only Sale and Rent are derived. JV/JD and Built to Suit keep their
 * hard gate: enquiring about one niche deal is not a standing brief for
 * niche stock, and must not become one that also excludes ordinary sale
 * listings.
 */
/** Shopping rent and nothing else — the only case whose stated budget
 *  is a monthly figure. Mirrors isRentOnlyIntent in
 *  src/lib/whatsapp/budget-band.ts, which decides which bands the lead
 *  was asked for in the first place. */
function isRentOnly(wanted: Set<ListingType>): boolean {
  return wanted.has('Rent') && !wanted.has('Sale');
}

function inferListingTypesFromInquiries(
  inquired: string[] | null | undefined
): Set<ListingType> {
  const wanted = new Set<ListingType>();
  for (const type of inquired || []) {
    if (type === 'Sale' || type === 'Rent') wanted.add(type);
  }
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
    const precedingText = text
      .substring(Math.max(0, index - 35), index)
      .split(/[\n.;]/)
      .at(-1)
      ?.trim();
    const negated = precedingText
      ? /(?:\b(?:not|except|excluding|exclude|avoid|never|outside)\s*(?:in\s*)?|\bno\s*|\b(?:dont|don't)\s*(?:want\s*)?)$/i.test(
          precedingText
        )
      : false;
    if (negated) return true;
    index = text.indexOf(cleanKeyword, index + 1);
  }
  return false;
}

/**
 * Extracts min and max budget bounds from unstructured requirements/notes
 * text. `maxIsCeiling` records whether the max came from ceiling phrasing
 * ("under/below/up to/max 1.5 Cr") rather than an anchor ("budget of
 * 20 cr") — a ceiling states no floor, an anchor implies one.
 */
function parseBudgetFromText(text: string): {
  min: number | null;
  max: number | null;
  maxIsCeiling: boolean;
} {
  const clean = text.toLowerCase();
  let maxBudgetVal: number | null = null;
  let minBudgetVal: number | null = null;
  let maxIsCeiling = false;

  const unitMultiplier = (unit: string) =>
    unit.startsWith('cr') ? 10000000 : 100000;

  const maxPattern =
    /(?:(under|below|up\s*to|max|maximum)|budget\s+of|budget\s+around|budget\s+is)\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*(cr|crore|lakh|lakhs|l|cr\.)/g;
  let match;
  while ((match = maxPattern.exec(clean)) !== null) {
    maxBudgetVal = parseFloat(match[2]) * unitMultiplier(match[3]);
    maxIsCeiling = match[1] !== undefined;
  }

  const minPattern =
    /(?:above|at\s*least|min|minimum)\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*(cr|crore|lakh|lakhs|l|cr\.)/g;
  while ((match = minPattern.exec(clean)) !== null) {
    minBudgetVal = parseFloat(match[1]) * unitMultiplier(match[2]);
  }

  return { min: minBudgetVal, max: maxBudgetVal, maxIsCeiling };
}

/** Extracts a minimum expected ROI/yield percentage from free text. */
function parseRoiFromText(text: string): number | null {
  const yieldPattern =
    /(?:yielding|yield|roi|return)\s*(?:of|is|above|greater\s*than|>)?\s*(\d+(?:\.\d+)?)\s*%/g;
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
function inferTypePrefsFromText(text: string): {
  groups: Set<SubtypeGroup>;
  categories: Set<Category>;
} {
  const groups = new Set<SubtypeGroup>();
  const categories = new Set<Category>();
  const has = (kw: string) => text.includes(kw) && !isNegated(text, kw);

  if (has('apartment') || has('flat') || has('penthouse') || has('studio'))
    groups.add('apartment');
  if (
    has('villa') ||
    has('independent house') ||
    has('row house') ||
    has('bungalow')
  )
    groups.add('house');
  if (
    has('plot') ||
    has('vacant land') ||
    (has('land') && !text.includes('landmark'))
  )
    categories.add('plot');
  if (
    has('commercial') ||
    has('office space') ||
    has('shop') ||
    has('showroom') ||
    has('warehouse')
  )
    categories.add('commercial');
  if (has('residential')) categories.add('residential');
  if (has('industrial')) categories.add('industrial');
  if (has('agricultural') || has('farmland') || has('farm land'))
    categories.add('agricultural');
  return { groups, categories };
}

/** Maps a legacy property_interests entry to groups/categories. ROI-style interests return nothing (not a type constraint). */
function mapLegacyInterest(interest: string): {
  groups: SubtypeGroup[];
  categories: Category[];
} {
  const s = interest.toLowerCase().trim();
  if (!s) return { groups: [], categories: [] };

  if (s.includes('roi') || s.includes('rental') || s.includes('yield'))
    return { groups: [], categories: [] };
  if (
    s.includes('site rate') ||
    s.includes('old building') ||
    s.includes('demolish')
  ) {
    // Redevelopment buyers: interested in land value — houses and plots
    return { groups: ['house'], categories: ['plot'] };
  }
  if (s.includes('plot') || s.includes('vacant land') || s === 'land')
    return { groups: [], categories: ['plot'] };
  if (s.includes('building')) {
    // "Vacant building" style interests span built structures
    return { groups: ['house', 'commercial-space'], categories: [] };
  }

  const canonical = normalizePropertyType(interest);
  if (canonical && TYPE_TO_GROUP[canonical])
    return { groups: [TYPE_TO_GROUP[canonical]], categories: [] };

  if (s.includes('apartment') || s.includes('flat'))
    return { groups: ['apartment'], categories: [] };
  if (s.includes('villa') || s.includes('house'))
    return { groups: ['house'], categories: [] };
  if (s.includes('commercial'))
    return { groups: [], categories: ['commercial'] };
  if (s.includes('residential'))
    return { groups: [], categories: ['residential'] };
  if (s.includes('industrial'))
    return { groups: [], categories: ['industrial'] };
  if (s.includes('agricultural') || s.includes('farm'))
    return { groups: [], categories: ['agricultural'] };
  return { groups: [], categories: [] };
}

/**
 * Entries agents type into an area field that name no locality —
 * "any", "anywhere", "any commercial location", "not specific". They
 * state the absence of a location constraint, so they are never matched
 * as a place; see the location gate, where one of them opens it.
 */
const AREA_PLACEHOLDER_PATTERN =
  /^(any|anywhere|all|not specific|no preference|flexible)\b/;

function isPlaceholderArea(area: string): boolean {
  return !!area && AREA_PLACEHOLDER_PATTERN.test(area);
}

function cleanArea(area: string): string {
  return area.toLowerCase().replace(/\./g, '').trim();
}

function coordinatesForArea(area: string): { lat: number; lng: number } | null {
  const clean = cleanArea(area);
  if (!clean) return null;
  const direct = BANGALORE_LOCALITIES_COORDS[clean];
  if (direct) return direct;

  const locality = Object.keys(BANGALORE_LOCALITIES_COORDS)
    .sort((a, b) => b.length - a.length)
    .find((name) => clean.includes(name));
  return locality ? BANGALORE_LOCALITIES_COORDS[locality] : null;
}

function parsePricePerSqftBudget(text: string): {
  min: number | null;
  max: number | null;
  maxIsCeiling: boolean;
} | null {
  const clean = text.toLowerCase();
  const pattern =
    /(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?\s*(?:psqft|p\s*sqft|per\s+sq(?:uare)?\.?\s*(?:ft|feet)|\/\s*sq\.?\s*(?:ft|feet))/g;
  let min: number | null = null;
  let max: number | null = null;
  let maxIsCeiling = false;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(clean)) !== null) {
    const value =
      Number(match[1].replace(/,/g, '')) *
      (match[2] === 'k' || match[2] === 'thousand' ? 1000 : 1);
    const before = clean.slice(Math.max(0, match.index - 24), match.index);
    const after = clean.slice(pattern.lastIndex, pattern.lastIndex + 24);
    const isMinimum =
      /(?:above|at\s*least|min|minimum)\s*$/.test(before) ||
      /^\s*(?:min|minimum|and\s+above)\b/.test(after);
    const isMaximum =
      /(?:under|below|up\s*to|max|maximum)\s*$/.test(before) ||
      /^\s*(?:max|maximum|or\s+below)\b/.test(after);

    if (isMinimum && !isMaximum) {
      min = value;
    } else {
      max = value;
      maxIsCeiling = isMaximum;
    }
  }

  return min !== null || max !== null ? { min, max, maxIsCeiling } : null;
}

// ── Main matcher ────────────────────────────────────────────────────

/**
 * Contacts matching a property, best first.
 *
 * `parties` is optional and changes the unit of the answer: without it
 * the list is per person, with it one row per deal (see
 * collapseMatchesToParties). Pass it wherever a duplicate would be
 * counted or messaged twice — Radar events, buyer digests, match counts
 * — and leave it off where each person is genuinely a separate target.
 */
function matchContactsSingleProfile(
  property: Partial<Property>,
  contacts: Contact[]
): MatchingResult[] {
  if (!property.price && !property.location && !property.type) {
    return [];
  }

  const propertyGroup = resolvePropertyGroup(property);
  const propertyCategory = propertyGroup
    ? GROUP_TO_CATEGORY[propertyGroup]
    : null;
  const propertyListingType = resolveListingType(property);
  const price = Number(property.price || 0);
  const rentalIncome = property.rental_income
    ? Number(property.rental_income)
    : null;
  const propertyRoi = property.roi
    ? Number(property.roi)
    : price > 0 && rentalIncome !== null
      ? ((rentalIncome * 12) / price) * 100
      : null;
  // Budget comparison value switches with listing type: Sale prices against
  // `price`, Rent/Built to Suit against monthly rent, JV/JD against `price`
  // only if one was entered (JV deals are usually matched on land/share
  // terms, not a price band).
  const totalBudgetComparisonValue =
    propertyListingType === 'Rent' || propertyListingType === 'Built to Suit'
      ? Number(property.rent_per_month || 0)
      : price;

  const propLoc = cleanArea(property.location || '');
  const propSub = cleanArea(property.sublocality || '');
  const propCity = cleanArea(property.city || '');
  const propProject = cleanArea(property.project || '');
  const propTags = (property.tags || []).map(cleanArea).filter(Boolean);
  const propBedrooms = property.bedrooms ? Number(property.bedrooms) : null;
  const landAreaSqft = toSquareFeet(
    property.land_area,
    property.land_area_unit
  );
  const propertyAreaSqft =
    landAreaSqft && landAreaSqft > 0
      ? landAreaSqft
      : property.area_sqft && Number(property.area_sqft) > 0
        ? Number(property.area_sqft)
        : null;
  const propertyPricePerSqft =
    property.price_per_sqft && Number(property.price_per_sqft) > 0
      ? Number(property.price_per_sqft)
      : price > 0 && propertyAreaSqft
        ? price / propertyAreaSqft
        : 0;

  const results: MatchingResult[] = [];

  for (const contact of contacts) {
    // A parked requirement (migration 194) is dormant on purpose: the
    // agent has said this brief is not live, so it stops matching as
    // well as sharing. Absent/true keeps the contact in, so every row
    // predating the column behaves as before.
    if (contact.requirement_active === false) continue;

    // A lead who closed their enquiry, and a contact an agent archived,
    // are out of the matching feed entirely (migration 230) — no match,
    // no Radar event, no digest, no co-broker share. Closing an enquiry
    // also parks the requirement above, so this is belt and braces for
    // contacts marked dead in bulk without touching their brief.
    if (contact.is_dead || contact.is_archived) continue;

    const sourceContact = resolveRequirementSource(contact);
    const notesText = (contact.contact_notes || [])
      .map((n) => n.note_text)
      .join(' ');
    const combinedText =
      `${sourceContact.requirements || ''} ${notesText}`.toLowerCase();
    const hasExtraction = !!sourceContact.pref_extracted_at;

    // ── Named-project match ───────────────────────────────────────
    // The buyer named specific projects/societies — agent-entered
    // (projects_of_interest) or AI-extracted (pref_projects), the same
    // explicit/AI split areas use. Internal property tags also carry
    // builder/campaign/deal names that structured listing fields may not,
    // so they participate in the same lookup. A property in one of them
    // is the strongest intent signal we have: it qualifies the contact
    // and forces a location match regardless of the type/locality gates.
    const wantedProjects = [
      ...new Set(
        [
          ...(sourceContact.projects_of_interest || []),
          ...(sourceContact.pref_projects || []),
        ]
          .map((p) => p.trim())
          .filter(Boolean)
      ),
    ];
    const projectMatch =
      wantedProjects.length > 0 &&
      wantedProjects.some(
        (p) =>
          textContainsProject(property.project || '', p) ||
          textContainsProject(property.title || '', p) ||
          propTags.some((tag) => textContainsProject(tag, p))
      );

    // Strict watchlist: the buyer wants these projects and nothing
    // else, so the list stops being a boost and becomes the first
    // gate — a listing outside it cannot reach them on type, area or
    // budget fit.
    if (
      sourceContact.strict_project_match &&
      wantedProjects.length > 0 &&
      !projectMatch
    )
      continue;

    // ── 0. Listing intent gate (Sale / Rent / JV/JD / Built to Suit) ──
    // JV/JD and Built to Suit are niche deals: they only ever surface for
    // contacts who have explicitly stated that intent, regardless of type/
    // location/budget fit. Sale/Rent stay soft — an unstated intent doesn't
    // exclude anyone (preserves pre-existing matching behavior), but a
    // stated contrary intent (e.g. "looking to rent") does.
    //
    // Stated intent wins, then the text heuristic, then the listings the
    // contact enquired about. Enquiry history belongs to the person
    // rather than to one brief, so it is read off the contact and not
    // off the requirement profile.
    const wantedListingTypes = new Set<ListingType>(
      (sourceContact.pref_listing_types || []).filter((t): t is ListingType =>
        (LISTING_TYPES as string[]).includes(t)
      )
    );
    if (wantedListingTypes.size === 0 && !hasExtraction) {
      inferListingTypesFromText(combinedText).forEach((t) =>
        wantedListingTypes.add(t)
      );
    }
    if (wantedListingTypes.size === 0) {
      inferListingTypesFromInquiries(contact.inquired_listing_types).forEach(
        (t) => wantedListingTypes.add(t)
      );
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

    for (const t of sourceContact.pref_property_types || []) {
      const g =
        TYPE_TO_GROUP[t] ||
        (normalizePropertyType(t)
          ? TYPE_TO_GROUP[normalizePropertyType(t)!]
          : undefined);
      if (g) wantedGroups.add(g);
    }
    for (const c of sourceContact.pref_property_categories || []) {
      if (
        [
          'residential',
          'commercial',
          'industrial',
          'agricultural',
          'plot',
        ].includes(c)
      ) {
        wantedCategories.add(c as Category);
      }
    }
    for (const interest of sourceContact.property_interests || []) {
      const mapped = mapLegacyInterest(interest);
      mapped.groups.forEach((g) => wantedGroups.add(g));
      mapped.categories.forEach((c) => wantedCategories.add(c));
    }
    // Text fallback only for contacts that haven't been AI-extracted yet
    if (
      !hasExtraction &&
      wantedGroups.size === 0 &&
      wantedCategories.size === 0
    ) {
      const inferred = inferTypePrefsFromText(combinedText);
      inferred.groups.forEach((g) => wantedGroups.add(g));
      inferred.categories.forEach((c) => wantedCategories.add(c));
    }

    const hasTypePrefs = wantedGroups.size > 0 || wantedCategories.size > 0;

    // The sector the buyer named, if any — every category except
    // 'plot', which cuts across all of them. Also read off a stated
    // subtype, so "Commercial Land" narrows the plot rung below on its
    // own, without the buyer having to say "commercial" twice.
    const statedSectors = new Set<Category>(
      [
        ...wantedCategories,
        ...[...wantedGroups].map((g) => GROUP_TO_CATEGORY[g]),
      ].filter((c): c is Category => !!c && c !== 'plot')
    );

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
        ![...wantedGroups].some(
          (g) => GROUP_TO_CATEGORY[g] === propertyCategory
        )
      ) {
        typeVerdict = 'partial';
      } else if (
        propertyGroup &&
        wantedCategories.has('plot') &&
        PLOT_GROUPS.includes(propertyGroup) &&
        // 'plot' says land rather than a building. It says nothing
        // about which sector, so it must not overrule one stated
        // beside it: a lead who answered "Land", then "Commercial or
        // Semi commercial", was shown two residential plots under a
        // line that read "Perfect — commercial land, up to ₹8 Cr",
        // because 'plot' alone had opened the gate to every plot in
        // inventory — residential and agricultural included.
        (statedSectors.size === 0 ||
          (propertyCategory && statedSectors.has(propertyCategory)))
      ) {
        typeVerdict = 'partial';
      } else {
        typeVerdict = 'mismatch';
      }
    }

    // Explicit category negation in text overrides ("no commercial please")
    if (
      typeVerdict !== 'mismatch' &&
      propertyCategory &&
      combinedText &&
      isNegated(combinedText, propertyCategory)
    ) {
      typeVerdict = 'mismatch';
    }

    // A named-project match is decisive — don't drop it on a type
    // mismatch (e.g. the property's type field is blank or slightly off).
    if (typeVerdict === 'mismatch' && !projectMatch) continue;

    // ── 2. ROI expectation ────────────────────────────────────────
    const minExpectedRoi =
      sourceContact.min_roi != null && Number(sourceContact.min_roi) > 0
        ? Number(sourceContact.min_roi)
        : sourceContact.pref_min_roi != null &&
            Number(sourceContact.pref_min_roi) > 0
          ? Number(sourceContact.pref_min_roi)
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
        roiVerdict =
          propertyRoi !== null && propertyRoi >= minExpectedRoi
            ? 'match'
            : 'mismatch';
      }
    }
    if (roiVerdict === 'mismatch') continue;

    // ── 3. Location ───────────────────────────────────────────────
    // A placeholder among the stated areas ("any commercial location")
    // is the agent saying location is open. The real localities beside it
    // still rank a hit; they just stop excluding everything else.
    const anyAreaAccepted = [
      ...(sourceContact.areas_of_interest || []),
      ...(sourceContact.pref_areas || []),
    ].some((a) => isPlaceholderArea(cleanArea(a)));

    const explicitAreas = (sourceContact.areas_of_interest || [])
      .map(cleanArea)
      .filter((a) => a && !isPlaceholderArea(a));

    // Google-resolved coordinates saved with the contact take precedence over
    // the static locality table, so areas outside it still radius-match.
    const contactAreaCoords: Record<string, { lat: number; lng: number }> = {};
    for (const g of sourceContact.areas_of_interest_geo || []) {
      if (g?.name && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
        contactAreaCoords[cleanArea(g.name)] = { lat: g.lat, lng: g.lng };
      }
    }
    const aiAreas = (sourceContact.pref_areas || [])
      .map(cleanArea)
      .filter((a) => a && !isPlaceholderArea(a));
    const wantedAreas = [...new Set([...explicitAreas, ...aiAreas])].filter(
      (a) => !isNegated(combinedText, a)
    );
    const excludedAreas = (sourceContact.pref_excluded_areas || [])
      .map(cleanArea)
      .filter(Boolean);

    const areaHitsProperty = (area: string) =>
      !!area &&
      (propLoc.includes(area) ||
        propSub.includes(area) ||
        propProject.includes(area) ||
        propTags.some((tag) => tag.includes(area)));

    // A negated/excluded locality covering this property disqualifies the
    // contact — unless they explicitly named this project, which wins over
    // a coincidental excluded-area overlap.
    const negativeHit =
      excludedAreas.some(areaHitsProperty) ||
      (propSub && isNegated(combinedText, propSub)) ||
      (propProject && isNegated(combinedText, propProject));
    if (negativeHit && !projectMatch) continue;

    let locationVerdict: MatchVerdict = 'unknown';
    if (wantedAreas.length > 0) {
      // 3.1 Proximity-based matching if coordinates are available
      const propertyCoords = coordinatesForArea(
        `${property.sublocality || ''} ${property.location || ''}`
      );
      const pLat =
        property.latitude != null && Number.isFinite(Number(property.latitude))
          ? Number(property.latitude)
          : (propertyCoords?.lat ?? null);
      const pLng =
        property.longitude != null &&
        Number.isFinite(Number(property.longitude))
          ? Number(property.longitude)
          : (propertyCoords?.lng ?? null);

      let checkedProximity = false;
      let hasProximityMatch = false;
      let hasProximityMismatch = false;

      if (pLat !== null && pLng !== null) {
        const maxAllowedDistance = sourceContact.strict_area_match ? 5 : 20;

        for (const area of wantedAreas) {
          const areaCoords =
            contactAreaCoords[area] ?? BANGALORE_LOCALITIES_COORDS[area];
          if (areaCoords) {
            checkedProximity = true;
            const dist = calculateHaversineDistance(
              pLat,
              pLng,
              areaCoords.lat,
              areaCoords.lng
            );
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
    // Direct mention of the property's locality/project/internal tag in
    // requirements or notes counts as a match. Tags are Engine-only, but
    // this lets an agent's own builder/campaign shorthand find inventory.
    if (locationVerdict !== 'match' && combinedText) {
      if (
        (propSub && propSub.length > 2 && combinedText.includes(propSub)) ||
        (propProject &&
          propProject.length > 2 &&
          combinedText.includes(propProject)) ||
        propTags.some((tag) => tag.length > 2 && combinedText.includes(tag))
      ) {
        locationVerdict = 'match';
      }
    }

    // A named-project match satisfies location outright.
    if (projectMatch) locationVerdict = 'match';

    if (locationVerdict === 'mismatch') {
      // Yield-focused commercial purchases are location-agnostic
      const yieldBypass =
        minExpectedRoi !== null &&
        propertyCategory === 'commercial' &&
        roiVerdict === 'match';
      const textBypass =
        combinedText.includes('any location') ||
        combinedText.includes('no location preference') ||
        combinedText.includes('location agnostic') ||
        combinedText.includes('yield focused') ||
        combinedText.includes('roi focused');
      if (yieldBypass || textBypass || anyAreaAccepted) {
        locationVerdict = 'unknown';
      } else {
        continue;
      }
    }

    // ── 4. Budget (applied last) ──────────────────────────────────
    const explicitMin =
      sourceContact.min_budget != null && Number(sourceContact.min_budget) > 0
        ? Number(sourceContact.min_budget)
        : null;
    const explicitMax =
      sourceContact.max_budget != null && Number(sourceContact.max_budget) > 0
        ? Number(sourceContact.max_budget)
        : null;
    let budgetMin =
      explicitMin ??
      (sourceContact.pref_budget_min != null
        ? Number(sourceContact.pref_budget_min)
        : null);
    let budgetMax =
      explicitMax ??
      (sourceContact.pref_budget_max != null
        ? Number(sourceContact.pref_budget_max)
        : null);
    let maxIsCeiling = false;
    if (budgetMin === null && budgetMax === null && !hasExtraction) {
      const parsed = parseBudgetFromText(combinedText);
      budgetMin = parsed.min;
      budgetMax = parsed.max;
      maxIsCeiling = parsed.maxIsCeiling;
    }

    const perSqftBudget = parsePricePerSqftBudget(combinedText);
    let budgetComparisonValue = totalBudgetComparisonValue;
    if (perSqftBudget) {
      budgetMin = perSqftBudget.min ?? budgetMin;
      budgetMax = perSqftBudget.max ?? budgetMax;
      maxIsCeiling = perSqftBudget.maxIsCeiling;
      budgetComparisonValue = propertyPricePerSqft;
    }

    const BUDGET_TOLERANCE_MIN = 0.2; // Allowing 20% gap/tolerance on lower side
    const BUDGET_TOLERANCE_MAX = 0.1; // Keeping strict 10% gap/tolerance on upper side
    // A max with no min still anchors intent: a ₹20 Cr buyer is not
    // shopping at ₹4 Cr. Half the max is the implied floor; the lower
    // tolerance below it grades partial, further out excludes. Three
    // maxima keep the old ceiling-only reading: "under X" phrasing in
    // text; a max at the entry band of its market (the bottom rung of
    // SALE_BANDS/RENT_BANDS in src/lib/whatsapp/budget-band.ts — "Under
    // ₹50 Lakh" is the whole bottom of the market, there is no floor to
    // imply); and a rent comparison for a contact who is not shopping
    // rent-only, whose max is a sale-scale number that would exclude
    // every rental if halved. "Either" is that case too: the ladder
    // asks such a lead for a SALE budget, so imposing half of it as a
    // monthly-rent floor would turn "show me both" into sale-only.
    const IMPLIED_FLOOR_OF_MAX = 0.5;
    const isRentComparison =
      propertyListingType === 'Rent' || propertyListingType === 'Built to Suit';
    const ENTRY_BAND_MAX = isRentComparison ? 25_000 : 5_000_000;
    let budgetVerdict: MatchVerdict = 'unknown';
    if (sourceContact.no_budget) {
      budgetVerdict = 'partial'; // flexible — no constraint stated on purpose
    } else if (
      (budgetMin !== null || budgetMax !== null) &&
      budgetComparisonValue > 0
    ) {
      const impliedFloor =
        budgetMax !== null &&
        !maxIsCeiling &&
        budgetMax > ENTRY_BAND_MAX &&
        (!isRentComparison || isRentOnly(wantedListingTypes))
          ? budgetMax * IMPLIED_FLOOR_OF_MAX
          : null;
      const floor = budgetMin ?? impliedFloor;
      const minOk = floor === null || budgetComparisonValue >= floor;
      const maxOk = budgetMax === null || budgetComparisonValue <= budgetMax;
      if (minOk && maxOk) {
        budgetVerdict = 'match';
      } else {
        const nearMin =
          floor === null ||
          budgetComparisonValue >= floor * (1 - BUDGET_TOLERANCE_MIN);
        const nearMax =
          budgetMax === null ||
          budgetComparisonValue <= budgetMax * (1 + BUDGET_TOLERANCE_MAX);
        budgetVerdict = nearMin && nearMax ? 'partial' : 'mismatch';
      }
    }
    if (budgetVerdict === 'mismatch') continue;

    // ── 5. Plot/built-up size ─────────────────────────────────────
    // Canonical square feet on both sides: the contact's band is stored
    // in sqft, the property's land area converts through the same table
    // the intake derives prices with. Built-up area stands in for
    // properties that have no land figure (apartments).
    const sizeMin =
      sourceContact.pref_land_area_min_sqft != null &&
      Number(sourceContact.pref_land_area_min_sqft) > 0
        ? Number(sourceContact.pref_land_area_min_sqft)
        : null;
    const sizeMax =
      sourceContact.pref_land_area_max_sqft != null &&
      Number(sourceContact.pref_land_area_max_sqft) > 0
        ? Number(sourceContact.pref_land_area_max_sqft)
        : null;
    let sizeVerdict: MatchVerdict = 'unknown';
    if (sizeMin !== null || sizeMax !== null) {
      const propAreaSqft = propertyAreaSqft;
      if (propAreaSqft !== null) {
        const minOk = sizeMin === null || propAreaSqft >= sizeMin;
        const maxOk = sizeMax === null || propAreaSqft <= sizeMax;
        if (minOk && maxOk) {
          sizeVerdict = 'match';
        } else {
          // ±10%, tighter than budget's band on purpose: the smaller/
          // bigger anchor (size-feedback.ts) is derived at 0.85 of the
          // rejected listing, and the two constants together guarantee
          // that listing lands outside even the near-miss band.
          const nearMin = sizeMin === null || propAreaSqft >= sizeMin * 0.9;
          const nearMax = sizeMax === null || propAreaSqft <= sizeMax * 1.1;
          sizeVerdict = nearMin && nearMax ? 'partial' : 'mismatch';
        }
      }
    }
    if (sizeVerdict === 'mismatch') continue;

    // ── 6. BHK fit ────────────────────────────────────────────────
    const bhkMin =
      sourceContact.pref_bhk_min != null ? Number(sourceContact.pref_bhk_min) : null;
    const bhkMax =
      sourceContact.pref_bhk_max != null ? Number(sourceContact.pref_bhk_max) : null;
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
      projectMatch ||
      typeVerdict === 'match' ||
      typeVerdict === 'partial' ||
      (!hasTypePrefs &&
        (locationVerdict === 'match' || roiVerdict === 'match'));
    if (!qualifies) continue;

    // ── Scoring ───────────────────────────────────────────────────
    let score = 0;
    if (typeVerdict === 'match') score += 45;
    else if (typeVerdict === 'partial') score += 35;

    // A named-project hit is the highest-intent signal — score it above a
    // generic locality match so these land at the top of the list.
    if (projectMatch) score += 40;

    if (locationVerdict === 'match') score += 30;
    else if (locationVerdict === 'partial') score += 12;

    if (budgetVerdict === 'match') score += 20;
    else if (budgetVerdict === 'partial') score += 8;

    if (bhkVerdict === 'match') score += 10;
    else if (bhkVerdict === 'mismatch') score -= bhkDistance >= 2 ? 15 : 5;

    if (sizeVerdict === 'match') score += 10;
    else if (sizeVerdict === 'partial') score += 4;

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
        size: sizeVerdict,
        project: projectMatch ? 'match' : 'unknown',
      },
      matchedFields: {
        budget: budgetVerdict === 'match',
        area: locationVerdict === 'match',
        interest: typeVerdict === 'match' || typeVerdict === 'partial',
        roi: roiVerdict === 'match',
        project: projectMatch,
      },
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Match each independent requirement as its own brief and keep the best
 * result for the contact. A buyer looking for a 1-acre commercial plot in
 * Akshayanagar and, separately, a 2–3 acre warehouse site in Dabaspete must
 * match either lane; merging those fields would require one impossible
 * property to satisfy both.
 */
export function getMatchingContacts(
  property: Partial<Property>,
  contacts: Contact[],
  parties?: Map<string, ContactParty>
): MatchingResult[] {
  const results: MatchingResult[] = [];

  for (const contact of contacts) {
    const activeProfiles = activeRequirementProfiles(contact);
    const hasLegacySource = hasLegacyRequirementSignals(contact);
    const shouldUseLegacyFallback =
      hasLegacySource &&
      !(contact.requirements || '').trim() &&
      activeProfiles.length > 0;

    const candidates = [
      ...(shouldUseLegacyFallback
        ? [{ ...contact, requirement_profiles: [] }]
        : [contact]),
      ...activeProfiles.map((profile) =>
        contactForRequirementProfile(contact, profile)
      ),
    ];
    const best = matchContactsSingleProfile(property, candidates)[0];
    if (best) results.push({ ...best, contact });
  }

  return collapseMatchesToParties(
    results.sort((a, b) => b.score - a.score),
    parties
  );
}

/**
 * One result per deal when the caller asked for it.
 *
 * Deliberately opt-in rather than automatic, because the right answer
 * differs by surface: a share dialog should still offer a husband and
 * wife separately (you may want to send to both), while a match count,
 * a Radar event and a buyer digest are about deals and must not report
 * one twice.
 *
 * The highest-scoring member wins the row. A party shares a
 * requirement, but the preferences behind it are often recorded on only
 * one of the two contacts, so the best score is the party's true score
 * — taking the primary's would understate a deal whose brief happens to
 * live on the spouse's record. Results arrive sorted, so the first
 * member seen is already the best; the primary breaks a tie only when
 * they scored equally.
 */
function collapseMatchesToParties(
  results: MatchingResult[],
  parties?: Map<string, ContactParty>
): MatchingResult[] {
  if (!parties?.size) return results;

  const byParty = new Map<string, MatchingResult>();
  const out: MatchingResult[] = [];

  for (const result of results) {
    const party = parties.get(result.contact.id);
    if (!party) {
      out.push(result);
      continue;
    }
    const held = byParty.get(party.id);
    if (!held) {
      const row: MatchingResult = {
        ...result,
        party: { id: party.id, name: party.name },
        alsoMatched: [],
      };
      byParty.set(party.id, row);
      out.push(row);
      continue;
    }
    const beatsOnTie =
      result.score === held.score &&
      result.contact.id === party.primaryContactId;
    if (beatsOnTie) {
      held.alsoMatched = [
        ...(held.alsoMatched ?? []).filter((c) => c.id !== result.contact.id),
        held.contact,
      ];
      held.contact = result.contact;
      held.details = result.details;
      held.matchedFields = result.matchedFields;
    } else {
      held.alsoMatched = [...(held.alsoMatched ?? []), result.contact];
    }
  }

  return out;
}

function hasLegacyRequirementSignals(contact: Contact): boolean {
  const hasNumeric = (value: unknown): boolean =>
    typeof value === 'number'
      ? Number.isFinite(value) && value > 0
      : typeof value === 'string'
        ? Number.isFinite(Number(value)) && Number(value) > 0
        : false;

  const hasText = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0;

  const hasArray = (value: unknown): boolean =>
    Array.isArray(value) && value.some((entry) => hasText(entry));

  return (
    hasText(contact.requirements) ||
    hasNumeric(contact.min_budget) ||
    hasNumeric(contact.max_budget) ||
    contact.no_budget === true ||
    hasNumeric(contact.min_roi) ||
    hasText(contact.property_interests?.join('')) ||
    hasArray(contact.areas_of_interest) ||
    hasArray(contact.projects_of_interest) ||
    hasArray(contact.pref_property_types) ||
    hasArray(contact.pref_property_categories) ||
    hasArray(contact.pref_areas) ||
    hasArray(contact.pref_excluded_areas) ||
    hasArray(contact.pref_projects) ||
    hasNumeric(contact.pref_bhk_min) ||
    hasNumeric(contact.pref_bhk_max) ||
    hasNumeric(contact.pref_budget_min) ||
    hasNumeric(contact.pref_budget_max) ||
    hasNumeric(contact.pref_land_area_min_sqft) ||
    hasNumeric(contact.pref_land_area_max_sqft) ||
    hasNumeric(contact.pref_min_roi) ||
    hasArray(contact.pref_listing_types) ||
    hasText(contact.pref_extracted_at || '')
  );
}

// ── Share audiences ─────────────────────────────────────────────────

export type MatchAudience = 'buyers' | 'agents' | 'all';

/**
 * Who a matched-contacts list offers. The one definition every surface
 * filters, prunes and displays by (mobile mirrors it in
 * mobile/lib/match-chips.ts). 'buyers' means every non-agent
 * classification rather than literally 'Buyer', so a match pool widened
 * to mixed roles can never strand a selected row outside all audiences.
 */
export function inMatchAudience(
  classification: string | null | undefined,
  audience: MatchAudience
): boolean {
  if (audience === 'all') return true;
  return audience === 'agents'
    ? classification === 'Agent'
    : classification !== 'Agent';
}
