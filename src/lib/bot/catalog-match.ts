// ============================================================
// Catalog matching for the showcase lead bot — pure, synchronous, and
// run over the listings already loaded on the page. The bot shows a
// buyer real matches BEFORE asking for their number, which is the whole
// reason the funnel converts; doing that with a network round-trip (let
// alone an AI call) would make it slow and cost the agent credits on
// every anonymous visitor.
// ============================================================

import type { Property } from '@/types';
import { RENT_INTENT } from './funnels';

export interface BudgetRange {
  min: number | null;
  max: number | null;
}

export interface MatchCriteria {
  intent?: string;
  category?: string;
  localities?: string[];
  budget?: BudgetRange;
}

export interface MatchResult {
  matches: Property[];
  /** True when criteria had to be dropped to find anything to show. */
  relaxed: boolean;
  /** Total listings in scope before category/locality/budget filtering. */
  scopeCount: number;
}

const UNIT_MULTIPLIERS: { pattern: RegExp; factor: number }[] = [
  { pattern: /^(cr|crore|crores)$/i, factor: 10_000_000 },
  { pattern: /^(l|lac|lacs|lakh|lakhs)$/i, factor: 100_000 },
  { pattern: /^(k|thousand)$/i, factor: 1_000 },
];

const VALUE_TOKEN =
  /(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|l|thousand|k)?/gi;
const CEILING_WORDS =
  /\b(under|below|upto|up to|less than|max|maximum|within|budget of)\b/i;
const FLOOR_WORDS =
  /\b(above|over|more than|min|minimum|at least|starting)\b|\+\s*$/i;
const OPEN_BUDGET = /\b(flexible|any|not sure|no idea|depends|open)\b/i;

/**
 * What a bare number means depends entirely on what is being bought.
 * "35 to 40" from someone looking to rent is ₹35k–₹40k a month; the same
 * words from a buyer are ₹35–40 lakh, and "1 to 2" from a buyer is
 * crores. Without this the parser read all of them as rupees — a budget
 * of ₹35 excludes every listing ever built.
 */
export type BudgetContext = 'rent' | 'sale';

/** Highest bare sale figure still read as crores. Above it the same
 *  number means lakh — "80" is eighty lakh, not eighty crore. */
const SALE_CRORE_CEILING = 60;

/**
 * Multiplier for figures the visitor left unqualified, by the
 * conventions people actually type in.
 *
 * Decided ONCE for the whole expression from the largest bare figure,
 * not per token. Choosing per token splits a range across the boundary:
 * "55 to 65" would read as 55 Cr to 65 L, a band spanning two orders of
 * magnitude that the visitor plainly did not mean.
 *
 * Rent: monthly figures are quoted in thousands ("35" = ₹35k). Four
 * digits or more is already a rupee amount ("18000").
 *
 * Sale: figures up to SALE_CRORE_CEILING are crores ("1 to 2" = ₹1–2
 * Cr, "60" = ₹60 Cr); past it they are lakh ("80" = ₹80 L). Anything
 * four digits or more is taken as written.
 */
function bareUnitFactor(largestBare: number, context: BudgetContext): number {
  if (context === 'rent') return largestBare < 1_000 ? 1_000 : 1;
  if (largestBare <= SALE_CRORE_CEILING) return 10_000_000;
  return largestBare < 1_000 ? 100_000 : 1;
}

function unitFactor(unit: string | undefined): number | null {
  if (!unit) return null;
  const match = UNIT_MULTIPLIERS.find((u) => u.pattern.test(unit));
  return match ? match.factor : null;
}

/**
 * Reads a budget out of either a chip label ("₹50L – ₹1Cr") or whatever
 * the visitor typed ("around 1.5 cr", "40k a month", "2-3 crore").
 * Bare numbers inherit the unit of the next qualified token, so "1 – 2Cr"
 * reads as 1Cr–2Cr rather than ₹1.
 */
export function parseBudgetText(
  text: string,
  context?: BudgetContext,
): BudgetRange {
  const raw = (text || '').trim();
  if (!raw || OPEN_BUDGET.test(raw)) return { min: null, max: null };

  const tokens: { value: number; factor: number | null }[] = [];
  for (const match of raw.matchAll(VALUE_TOKEN)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    tokens.push({ value, factor: unitFactor(match[2]) });
  }
  if (!tokens.length) return { min: null, max: null };

  let trailingFactor: number | null = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].factor) trailingFactor = tokens[i].factor;
    else tokens[i].factor = trailingFactor;
  }

  // Figures the visitor left unqualified all take the same multiplier,
  // chosen from the largest of them. Without a context the old literal
  // reading stands, so every existing caller behaves as before.
  const bareValues = tokens.filter((t) => !t.factor).map((t) => t.value);
  const bareFactor =
    context && bareValues.length > 0
      ? bareUnitFactor(Math.max(...bareValues), context)
      : 1;

  const amounts = tokens
    .map((t) => t.value * (t.factor ?? bareFactor))
    .sort((a, b) => a - b);

  if (amounts.length >= 2) {
    return { min: amounts[0], max: amounts[amounts.length - 1] };
  }

  const only = amounts[0];
  if (FLOOR_WORDS.test(raw)) return { min: only, max: null };
  if (CEILING_WORDS.test(raw)) return { min: null, max: only };
  // A bare figure is how buyers state a ceiling ("my budget is 1.5cr").
  // A little headroom keeps a listing priced just above it in play.
  return { min: null, max: Math.round(only * 1.1) };
}

function listingPrice(property: Property, wantsRent: boolean): number | null {
  if (wantsRent) return property.rent_per_month ?? null;
  return property.price || null;
}

function wantsRentListing(intent: string | undefined): boolean {
  return intent === RENT_INTENT;
}

function inScope(property: Property, intent: string | undefined): boolean {
  const listingType = property.listing_type || 'Sale';
  return wantsRentListing(intent)
    ? listingType === 'Rent'
    : listingType !== 'Rent';
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "3 BHK apartment" carries both a bedroom count and a type. */
function bedroomsFromText(text: string): number | null {
  const match = /(\d+)\s*(bhk|bed)/i.exec(text);
  if (!match) return null;
  const beds = Number(match[1]);
  return Number.isFinite(beds) && beds > 0 ? beds : null;
}

/**
 * Qualifiers that sit in front of half the catalog, so on their own they
 * say nothing about what the visitor asked for. A buyer who says
 * "Residential House" is asking about the house, not the "residential" —
 * matching on that word alone offered a PG building as a fit.
 */
const GENERIC_CATEGORY_WORDS = new Set([
  'residential',
  'commercial',
  'property',
  'properties',
  'investment',
  'unit',
  'units',
  'purpose',
  'for',
  'space',
  'spaces',
  'farming',
  'farm',
  'farmland',
  'agri',
  'agricultural',
  'agriculture',
  'new',
]);

/** A word hits either by appearing in the listing's text, or by carrying
 *  the listing's type inside it — which is how "Villas" still matches a
 *  "Villa". Guarded on a non-empty type: every word contains ''. */
function categoryWordHits(word: string, haystack: string, type: string): boolean {
  if (word === 'plot') {
    return (
      haystack.includes('plot') ||
      haystack.includes('site') ||
      haystack.includes('land')
    );
  }
  if (word === 'agricultural') {
    return (
      haystack.includes('agricultural') ||
      haystack.includes('farm land') ||
      haystack.includes('farming') ||
      haystack.includes('farmland') ||
      type === 'agricultural land'
    );
  }
  return haystack.includes(word) || (type.length > 0 && word.includes(type));
}

function matchesCategory(property: Property, category: string): boolean {
  const wanted = normalize(category);
  if (!wanted) return true;

  const beds = bedroomsFromText(category);
  if (beds !== null && property.bedrooms && property.bedrooms !== beds)
    return false;

  const type = normalize(property.type || '');
  if (type && type === wanted) return true;

  const isAgriculturalIntent = /\bagricultur(?:al|e)\b|\bfarms?\b|\bfarming\b|\bfarmland\b|\bagri\b/.test(
    wanted
  );
  const isPlotIntent = /\bplots?\b|\bplotted\b|\bsite\b|\bvacant\b/.test(wanted);

  const words = wanted
    .split(' ')
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && w !== 'bhk')
    .map((w) => {
      if (w === 'plot' || w === 'plots' || w === 'plotted') return 'plot';
      if (w === 'site') return 'plot';
      if (/\bfarms?\b|\bfarming\b|\bfarmland\b|\bagri\b|\bagricultural\b|\bagriculture\b/.test(w))
        return 'agricultural';
      return w;
    })
    .filter((w) => {
      if (w === 'plot' && isAgriculturalIntent) return false;
      if (w === 'land' && (isAgriculturalIntent || isPlotIntent)) return false;
      return true;
    });

  if (!words.length) return beds === null || property.bedrooms === beds;

  const haystack = normalize(
    [
      property.type,
      property.title,
      property.project,
      property.ideal_for,
      property.land_zone,
    ]
      .filter(Boolean)
      .join(' ')
  );
  // Decide on the words that carry the request. Only when every word is
  // a generic qualifier ("Commercial") do those get to match on their own.
  const distinctive = words.filter((w) => !GENERIC_CATEGORY_WORDS.has(w));
  const decisive = distinctive.length ? distinctive : words;
  return decisive.some((w) => categoryWordHits(w, haystack, type));
}

function matchesLocality(property: Property, localities: string[]): boolean {
  if (!localities.length) return true;
  const haystack = normalize(
    [property.sublocality, property.location, property.city, property.project]
      .filter(Boolean)
      .join(' ')
  );
  return localities.some((locality) => {
    const wanted = normalize(locality);
    return Boolean(wanted) && haystack.includes(wanted);
  });
}

function matchesBudget(
  property: Property,
  budget: BudgetRange,
  wantsRent: boolean
): boolean {
  if (budget.min === null && budget.max === null) return true;
  const price = listingPrice(property, wantsRent);
  if (!price) return true;
  if (budget.min !== null && price < budget.min) return false;
  if (budget.max !== null && price > budget.max) return false;
  return true;
}

function score(
  property: Property,
  criteria: MatchCriteria,
  wantsRent: boolean
): number {
  let total = 0;
  if (criteria.category && matchesCategory(property, criteria.category))
    total += 3;
  if (
    criteria.localities?.length &&
    matchesLocality(property, criteria.localities)
  )
    total += 2;
  if (criteria.budget && matchesBudget(property, criteria.budget, wantsRent))
    total += 2;
  if (property.images?.length) total += 1;
  return total;
}

/**
 * Returns the best listings for what the visitor told the bot. Criteria
 * are relaxed in order of how much a buyer will forgive — locality
 * first, then budget — so the bot always has something to show rather
 * than dead-ending on "no results".
 */
export function matchProperties(
  properties: Property[],
  criteria: MatchCriteria,
  limit = 3
): MatchResult {
  const wantsRent = wantsRentListing(criteria.intent);
  const scope = properties.filter((p) => inScope(p, criteria.intent));
  const localities = criteria.localities?.filter(Boolean) ?? [];
  const budget = criteria.budget ?? { min: null, max: null };

  const passes: ((p: Property) => boolean)[][] = [
    [
      (p) => (criteria.category ? matchesCategory(p, criteria.category) : true),
      (p) => matchesLocality(p, localities),
      (p) => matchesBudget(p, budget, wantsRent),
    ],
    [
      (p) => (criteria.category ? matchesCategory(p, criteria.category) : true),
      (p) => matchesBudget(p, budget, wantsRent),
    ],
    [(p) => (criteria.category ? matchesCategory(p, criteria.category) : true)],
    [],
  ];

  for (let i = 0; i < passes.length; i++) {
    const filters = passes[i];
    const found = scope.filter((p) => filters.every((f) => f(p)));
    if (found.length) {
      const ranked = [...found].sort((a, b) => {
        const diff =
          score(b, criteria, wantsRent) - score(a, criteria, wantsRent);
        if (diff !== 0) return diff;
        return (
          (listingPrice(a, wantsRent) ?? 0) - (listingPrice(b, wantsRent) ?? 0)
        );
      });
      return {
        matches: ranked.slice(0, limit),
        relaxed: i > 0,
        scopeCount: scope.length,
      };
    }
  }

  return { matches: [], relaxed: true, scopeCount: scope.length };
}

function topByFrequency(
  values: (string | null | undefined)[],
  limit: number
): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const value of values) {
    const label = (value || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((e) => e.label);
}

/** Chip options for the category step — only types actually on offer. */
export function catalogCategories(properties: Property[], limit = 6): string[] {
  return topByFrequency(
    properties.map((p) => p.type),
    limit
  );
}

/** Chip options for the locality step, most-stocked area first. */
export function catalogLocalities(properties: Property[], limit = 8): string[] {
  return topByFrequency(
    properties.map((p) => p.sublocality || p.location || p.city),
    limit
  );
}
