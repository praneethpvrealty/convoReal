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
export function parseBudgetText(text: string): BudgetRange {
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

  const amounts = tokens
    .map((t) => t.value * (t.factor ?? 1))
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

function matchesCategory(property: Property, category: string): boolean {
  const wanted = normalize(category);
  if (!wanted) return true;

  const beds = bedroomsFromText(category);
  if (beds !== null && property.bedrooms && property.bedrooms !== beds)
    return false;

  const words = wanted
    .split(' ')
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && w !== 'bhk');
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
  return words.some(
    (w) => haystack.includes(w) || w.includes(normalize(property.type || ''))
  );
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
