import type { Contact, Property } from '@/types';
import { normalizePropertyType } from '@/lib/property-types';

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
  const price = Number(property.price || 0);
  const rentalIncome = property.rental_income ? Number(property.rental_income) : null;
  const propertyRoi = property.roi
    ? Number(property.roi)
    : price > 0 && rentalIncome !== null
      ? ((rentalIncome * 12) / price) * 100
      : null;

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
      roiVerdict = propertyRoi !== null && propertyRoi >= minExpectedRoi ? 'match' : 'mismatch';
    }
    if (roiVerdict === 'mismatch') continue;

    // ── 3. Location ───────────────────────────────────────────────
    const explicitAreas = (contact.areas_of_interest || [])
      .map(cleanArea)
      .filter((a) => !AREA_PLACEHOLDERS.includes(a));
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
      if (wantedAreas.some(areaHitsProperty)) {
        locationVerdict = 'match';
      } else if (propCity && wantedAreas.some((a) => propCity.includes(a))) {
        locationVerdict = 'partial';
      } else {
        locationVerdict = 'mismatch';
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

    const BUDGET_TOLERANCE = 0.1;
    let budgetVerdict: MatchVerdict = 'unknown';
    if (contact.no_budget) {
      budgetVerdict = 'partial'; // flexible — no constraint stated on purpose
    } else if ((budgetMin !== null || budgetMax !== null) && price > 0) {
      const minOk = budgetMin === null || price >= budgetMin;
      const maxOk = budgetMax === null || price <= budgetMax;
      if (minOk && maxOk) {
        budgetVerdict = 'match';
      } else {
        const nearMin = budgetMin === null || price >= budgetMin * (1 - BUDGET_TOLERANCE);
        const nearMax = budgetMax === null || price <= budgetMax * (1 + BUDGET_TOLERANCE);
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
