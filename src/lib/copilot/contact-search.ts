import type {
  ExtractedPreferences,
  ListingType,
  PropertyCategory,
} from '@/lib/ai/preference-types';
import { bhkRangeFromRequirement } from '@/lib/ai/preference-extraction';
import { PROPERTY_CATEGORY_VALUES } from '@/lib/ai/preference-types';
import { normalizePropertyType } from '@/lib/property-types';
import { localityStems } from '@/lib/locality-match';
import { formatInrCompact } from '@/lib/format/currency';
import { entityHref } from './entities';
import type { CopilotNavigationLink } from './engine';

export const CONTACT_SEARCH_LIMIT = 4;

export interface ContactSearchQuery {
  areas: string[];
  areaProbes: string[][];
  categories: PropertyCategory[];
  propertyTypes: string[];
  typeProbes: string[];
  bhkMin: number | null;
  bhkMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  listingTypes: ListingType[];
}

export interface ContactSearchMatch {
  id: string;
  label: string;
  classification: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  matchedArea: string | null;
}

export interface ContactSearchResult {
  matches: ContactSearchMatch[];
  total: number;
}

export type ContactSearchExecutor = (
  query: ContactSearchQuery
) => Promise<ContactSearchResult>;

const CATEGORY_PROBES: Record<PropertyCategory, string[]> = {
  residential: [
    'residential',
    'flat',
    'apartment',
    'villa',
    'house',
    'penthouse',
    'studio',
    'builder floor',
    'bhk',
    'duplex',
    'bungalow',
  ],
  commercial: [
    'commercial',
    'office',
    'shop',
    'showroom',
    'warehouse',
    'godown',
    'it park',
    'sez',
    'retail',
  ],
  industrial: ['industrial', 'warehouse', 'godown', 'shed', 'factory'],
  agricultural: ['agricultural', 'farm'],
  plot: ['plot', 'site', 'land'],
};

const SPECIFIC_TYPE_PATTERNS: RegExp[] = [
  /\bpent\s*house\b/i,
  /\bstudio\b/i,
  /\bvillas?\b/i,
  /\bbuilder\s+floors?\b/i,
  /\bfarm\s*houses?\b/i,
  /\bwarehouses?\b|\bgodowns?\b/i,
  /\bindustrial\s+sheds?\b/i,
  /\bit\s+park\b|\bsez\b/i,
  /\boffices?\b|\boffice\s+space\b/i,
  /\bshowrooms?\b/i,
  /\bshops?\b/i,
  /\bflats?\b|\bapartments?\b/i,
  /\bindependent\s+houses?\b|\bbungalows?\b|\brow\s+houses?\b/i,
  /\bpg\b|\bhostel\b|\bpaying\s+guest\b/i,
];

const SUBJECT =
  '(?:contacts?|buyers?|leads?|clients?|customers?|people|persons?|anyone|someone|investors?|tenants?|parties|who)';
const NEED =
  '(?:looking|wants?|wanted|wanting|interested|searching|seeking|hunting|needs?|requires?|requirements?|enquir(?:ed|ing|y)|inquir(?:ed|ing|y)|asking|asked|chahiye|dhoond|dhundh|khoj|talash)';
const FIND =
  '(?:find|list|show|get|give|pull|fetch|search|filter|which|any|do\\s+(?:i|we)\\s+have|is\\s+there|are\\s+there|kaun|kon|koi)';

const INSTRUCTIONAL =
  /\b(?:how\s+(?:do|can|should|to)\b|show\s+me\s+how|where\s+(?:do|can)\s+i)/i;
const ADD_INTENT = /^\s*(?:please\s+)?(?:add|create|save|new|import)\b/i;
const OUTBOUND_INTENT = /\b(?:share|send|forward|broadcast)\b/i;

const LOCALITY_STOP =
  '(?:under|below|above|over|upto|up\\s+to|within|with|for|budget|between|who|whose|that|which|and|or|around|near|looking|interested|searching|wanting|want|wants|needs?|rent|lease|buy|sale|purchase|bhk|from|at|in|mein|me)';
const LOCALITY_PATTERN = new RegExp(
  String.raw`\b(?:in|at|near|around|from)\s+(?:the\s+)?([^,.?!;]+?)(?=\s+${LOCALITY_STOP}\b|\s*[,.?!;]|\s*$)`,
  'gi'
);
const LOCALITY_TRAILERS =
  /\s+(?:area|areas|locality|location|side|region|zone|vicinity)$/i;

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const UNIT = String.raw`\s*(crores?|cr|lakhs?|lacs?|lakh|l|thousand|k)?`;
const AMOUNT = `(?:₹|rs\\.?|inr)?\\s*${NUMBER}${UNIT}`;
const BUDGET_RANGE = new RegExp(
  String.raw`(?:between\s+)?${AMOUNT}\s*(?:-|–|—|to|and)\s*${AMOUNT}\b`,
  'i'
);
const BUDGET_MAX = new RegExp(
  String.raw`\b(?:under|below|upto|up\s+to|max(?:imum)?|within|less\s+than|not\s+more\s+than|budget(?:\s+of)?|around|approx(?:imately)?|about|for)\s*${AMOUNT}\b`,
  'i'
);
const BUDGET_MIN = new RegExp(
  String.raw`\b(?:above|over|more\s+than|min(?:imum)?|at\s+least|starting(?:\s+at|\s+from)?|from)\s*${AMOUNT}\b`,
  'i'
);

function toRupees(value: string, unit: string | undefined): number | null {
  const amount = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const u = unit?.toLowerCase();
  if (u === 'cr' || u?.startsWith('crore')) return amount * 10_000_000;
  if (u === 'l' || u?.startsWith('lac') || u?.startsWith('lakh'))
    return amount * 100_000;
  if (u === 'k' || u === 'thousand') return amount * 1_000;
  if (amount <= 60) return amount * 10_000_000;
  if (amount <= 999) return amount * 100_000;
  return amount;
}

function parseBudget(text: string): { min: number | null; max: number | null } {
  const stripped = text.replace(/\b\d+(?:\.5)?\s*-?\s*bhk\b/gi, ' ');
  const range = BUDGET_RANGE.exec(stripped);
  if (range) {
    const first = toRupees(range[1], range[2] ?? range[4]);
    const second = toRupees(range[3], range[4] ?? range[2]);
    if (first != null && second != null) {
      return { min: Math.min(first, second), max: Math.max(first, second) };
    }
  }
  const max = BUDGET_MAX.exec(stripped);
  const min = BUDGET_MIN.exec(stripped);
  return {
    min: min ? toRupees(min[1], min[2]) : null,
    max: max ? toRupees(max[1], max[2]) : null,
  };
}

function isNegated(text: string, index: number): boolean {
  return /\b(?:no|not|except|excluding|avoid|without)\s*$/i.test(
    text.slice(Math.max(0, index - 12), index)
  );
}

function parseCategories(text: string): PropertyCategory[] {
  const lower = text.toLowerCase();
  const found = new Set<PropertyCategory>();
  const probe = (re: RegExp, category: PropertyCategory) => {
    const match = re.exec(lower);
    if (match && !isNegated(lower, match.index)) found.add(category);
  };
  probe(/\bresidential\b/, 'residential');
  probe(/\bcommercial\b/, 'commercial');
  probe(/\bindustrial\b/, 'industrial');
  probe(/\bagricultural\b|\bfarm\s*lands?\b|\bagri\b/, 'agricultural');
  probe(/\bplots?\b|\bsites?\b|\bvacant\s+land\b/, 'plot');
  if (/\bland\b/.test(lower) && !/\bfarm\s*land\b/.test(lower)) {
    probe(/\bland\b/, 'plot');
  }
  return [...found];
}

function parsePropertyTypes(text: string): string[] {
  const types = new Set<string>();
  for (const pattern of SPECIFIC_TYPE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match || isNegated(text, match.index)) continue;
    const canonical = normalizePropertyType(match[0]);
    if (canonical) types.add(canonical);
  }
  return [...types];
}

function parseAreas(message: string): string[] {
  const text = message.replace(/\binterested\s+in\s+/gi, 'interested ');
  const candidates: string[] = [];
  for (const match of text.matchAll(LOCALITY_PATTERN)) {
    const raw = match[1].replace(LOCALITY_TRAILERS, '').trim();
    if (!raw || /^\d/.test(raw)) continue;
    if (/^(?:a|an|the|my|our|this|that|any|some)$/i.test(raw)) continue;
    const lower = raw.toLowerCase();
    if (parseCategories(lower).length && localityStems(lower).length === 0)
      continue;
    if (SPECIFIC_TYPE_PATTERNS.some((re) => re.test(lower))) continue;
    if (
      /^(?:property|properties|listing|listings|flat|flats|house|houses|budget|contacts?|list|crm|app|system|database|inventory)$/i.test(
        lower
      )
    )
      continue;
    candidates.push(raw.slice(0, 60));
  }
  return candidates.length ? [candidates[0]] : [];
}

function parseListingTypes(text: string): ListingType[] {
  const lower = text.toLowerCase();
  const types = new Set<ListingType>();
  if (
    /\b(?:rent|rental|rented|lease|leasing|tenant|to\s+let|kiraye)\b/.test(
      lower
    )
  )
    types.add('Rent');
  if (/\b(?:buy|buying|purchase|purchasing|own|kharid)\b/.test(lower))
    types.add('Sale');
  return [...types];
}

export function typeProbesFor(
  categories: PropertyCategory[],
  propertyTypes: string[]
): string[] {
  const probes = new Set<string>();
  for (const category of categories) {
    for (const probe of CATEGORY_PROBES[category]) probes.add(probe);
  }
  for (const type of propertyTypes) {
    for (const part of type.toLowerCase().split('/')) {
      const clean = part.trim();
      if (clean && clean !== 'others') probes.add(clean);
    }
  }
  return [...probes];
}

export function areaProbesFor(areas: string[]): string[][] {
  return areas
    .map((area) => {
      const stems = localityStems(area);
      const probes = stems.length ? stems : [area.trim().toLowerCase()];
      return [...new Set(probes.filter(Boolean))];
    })
    .filter((probes) => probes.length > 0);
}

export function isContactSearchQuestion(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 500) return false;
  if (INSTRUCTIONAL.test(text) || ADD_INTENT.test(text)) return false;
  if (OUTBOUND_INTENT.test(text)) return false;
  if (/[#@&]\S/.test(text)) return false;
  const subjectThenNeed = new RegExp(
    String.raw`\b${SUBJECT}\b[\s\S]{0,40}\b${NEED}\b`,
    'i'
  );
  const findThenSubject = new RegExp(
    String.raw`\b${FIND}\b[\s\S]{0,30}\b${SUBJECT}\b`,
    'i'
  );
  const subjectThenPlace = new RegExp(
    String.raw`\b${SUBJECT}\b[\s\S]{0,30}\b(?:in|for|near|around|with)\b`,
    'i'
  );
  return (
    subjectThenNeed.test(text) ||
    findThenSubject.test(text) ||
    (subjectThenPlace.test(text) &&
      /\b(?:contacts?|buyers?|leads?|clients?|customers?|investors?|tenants?)\b/i.test(
        text
      ))
  );
}

export function hasSearchCriteria(query: ContactSearchQuery): boolean {
  return (
    query.areaProbes.length > 0 ||
    query.typeProbes.length > 0 ||
    query.bhkMin != null ||
    query.bhkMax != null ||
    query.budgetMin != null ||
    query.budgetMax != null
  );
}

export function parseContactSearchQuery(message: string): ContactSearchQuery {
  const areas = parseAreas(message);
  const categories = parseCategories(message);
  const propertyTypes = parsePropertyTypes(message);
  const bhk = bhkRangeFromRequirement(message);
  const budget = parseBudget(message);
  return {
    areas,
    areaProbes: areaProbesFor(areas),
    categories,
    propertyTypes,
    typeProbes: typeProbesFor(categories, propertyTypes),
    bhkMin: bhk.min,
    bhkMax: bhk.max,
    budgetMin: budget.min,
    budgetMax: budget.max,
    listingTypes: parseListingTypes(message),
  };
}

export function contactSearchFromPreferences(
  preferences: ExtractedPreferences
): ContactSearchQuery {
  const categories = preferences.property_categories.filter((category) =>
    (PROPERTY_CATEGORY_VALUES as readonly string[]).includes(category)
  );
  const areas = [...preferences.areas, ...preferences.projects].slice(0, 3);
  return {
    areas,
    areaProbes: areaProbesFor(areas),
    categories,
    propertyTypes: preferences.property_types,
    typeProbes: typeProbesFor(categories, preferences.property_types),
    bhkMin: preferences.bhk_min,
    bhkMax: preferences.bhk_max,
    budgetMin: preferences.budget_min,
    budgetMax: preferences.budget_max,
    listingTypes: preferences.listing_types,
  };
}

function budgetLabel(min: number | null, max: number | null): string | null {
  if (min != null && max != null) {
    return `${formatInrCompact(min)}–${formatInrCompact(max)}`;
  }
  if (max != null) return `under ${formatInrCompact(max)}`;
  if (min != null) return `above ${formatInrCompact(min)}`;
  return null;
}

export function describeContactSearch(query: ContactSearchQuery): string {
  const what = query.propertyTypes.length
    ? query.propertyTypes.join(' / ')
    : query.categories.length
      ? query.categories.join(' / ')
      : null;
  const bhk =
    query.bhkMin != null || query.bhkMax != null
      ? query.bhkMin != null &&
        query.bhkMax != null &&
        query.bhkMin !== query.bhkMax
        ? `${query.bhkMin}–${query.bhkMax} BHK`
        : `${query.bhkMin ?? query.bhkMax} BHK`
      : null;
  const subject = [bhk, what].filter(Boolean).join(' ') || 'property';
  const listing = query.listingTypes.includes('Rent')
    ? 'to rent'
    : query.listingTypes.includes('Sale')
      ? 'to buy'
      : null;
  const area = query.areas.length ? `in ${query.areas.join(', ')}` : null;
  const budget = budgetLabel(query.budgetMin, query.budgetMax);
  return [subject, listing, area, budget].filter(Boolean).join(' ');
}

export function contactSearchListUrl(query: ContactSearchQuery): string {
  const term = [query.areas[0], query.propertyTypes[0] ?? query.categories[0]]
    .filter(Boolean)
    .join(' ');
  return term ? `/contacts?search=${encodeURIComponent(term)}` : '/contacts';
}

function matchSubtitle(match: ContactSearchMatch): string | undefined {
  const parts = [
    match.classification,
    budgetLabel(match.budgetMin, match.budgetMax),
    match.matchedArea,
  ].filter((part): part is string => !!part);
  return parts.length ? parts.join(' · ') : undefined;
}

export function buildContactSearchAnswer(
  query: ContactSearchQuery,
  result: ContactSearchResult
): { reply: string; links: CopilotNavigationLink[] } {
  const criteria = describeContactSearch(query);
  if (result.total === 0 || result.matches.length === 0) {
    return {
      reply: `No contacts are looking for ${criteria} yet. Try a nearby area or a broader property type, or add the requirement to a contact so they show up here.`,
      links: [
        { label: 'Open Contacts', navigateTo: contactSearchListUrl(query) },
      ],
    };
  }
  const shown = result.matches.length;
  const headline =
    result.total === 1
      ? `1 contact is looking for ${criteria}:`
      : result.total > shown
        ? `${result.total} contacts are looking for ${criteria}. Top ${shown}:`
        : `${result.total} contacts are looking for ${criteria}:`;
  const links: CopilotNavigationLink[] = result.matches.map((match) => ({
    label: match.label,
    subtitle: matchSubtitle(match),
    navigateTo: entityHref('contact', match.id),
  }));
  if (result.total > shown) {
    links.push({
      label: `See all ${result.total} in Contacts`,
      navigateTo: contactSearchListUrl(query),
    });
  }
  return {
    reply: `${headline}\n${result.matches.map((m) => `• ${m.label}${matchSubtitle(m) ? ` — ${matchSubtitle(m)}` : ''}`).join('\n')}\n\nTap a name to open the contact.`,
    links,
  };
}
