// ============================================================
// "No this 40,000 sqft one"
//
// Two listings went to a buyer forty-eight seconds apart. They asked
// for the exact location, were answered from the second, and corrected
// us by size — and the correction carried a size, so it read as a
// requirement and nobody answered it at all. A buyer who has just been
// sent a handful of listings points at one of them the way people do:
// by its area, its price, its bedrooms, or a word from its title. This
// reads that pointer against the listings actually in their thread,
// and only ever names one.
// ============================================================

import { SQFT_PER_AREA_UNIT } from '@/lib/inventory/property-options';

export interface DescribedCandidate {
  id: string;
  title?: string | null;
  location?: string | null;
  sublocality?: string | null;
  project?: string | null;
  price?: number | string | null;
  area_sqft?: number | string | null;
  super_built_area?: number | string | null;
  land_area?: number | string | null;
  land_area_unit?: string | null;
  bedrooms?: number | string | null;
}

type Measure =
  | { kind: 'area'; value: number }
  | { kind: 'price'; value: number }
  | { kind: 'bhk'; value: number };

const MEASURE_SOURCE =
  '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(sq\\.?\\s*(?:ft|feet)|sqft|sft|sq\\.?\\s*(?:yds?|yards?)|sqyds?|sq\\.?\\s*(?:m|mt|mtrs?|meters?|metres?)|sqm|acres?|guntas?|gunthas?|cents?|grounds?|cr|crores?|lakhs?|lacs?|bhk)\\b';
/** Tested, never iterated: a global regex keeps its lastIndex between
 *  calls, and the step tests the text before the resolver parses it. */
const MEASURE = new RegExp(MEASURE_SOURCE, 'i');
const MEASURES = new RegExp(MEASURE_SOURCE, 'gi');

/** "this", "that one", "the other one": the buyer is pointing back.
 *  A bare "one" is a quantity ("I want one 2400 sqft plot"), so it
 *  counts only after "the", as in "the 40,000 sqft one". */
const REFERENCE_MARKER =
  /\b(this|that|these|those|other|same|above|earlier|previous|former|latter|meant)\b|\bthe\s+(?:\S+\s+){1,4}one\b/i;

/** "the Chikatogur one", "that Kothnur one": a listing pointed at by a
 *  word of its own rather than a figure. Only "one" closes it — "this
 *  kind of house" is a requirement, not a pointer. */
const DESCRIBED_POINTER = /\b(?:the|this|that)\s+((?:\S+\s+){1,3})one\b/i;

const RELATIVE_TOLERANCE = 0.01;

const STOPWORDS = new Set([
  'this',
  'that',
  'these',
  'those',
  'with',
  'from',
  'have',
  'what',
  'where',
  'which',
  'when',
  'your',
  'about',
  'please',
  'share',
  'send',
  'location',
  'exact',
  'details',
  'property',
  'listing',
  'plot',
  'site',
  'land',
  'flat',
  'house',
  'villa',
  'apartment',
  'commercial',
  'residential',
  'sqft',
  'acre',
  'acres',
  'crore',
  'lakh',
  'mean',
  'meant',
  'other',
  'same',
  'only',
  'also',
  'want',
  'need',
  'looking',
  'interested',
  'option',
  'options',
  'first',
  'second',
  'third',
  'last',
  'next',
  'previous',
  'earlier',
  'above',
  'latest',
  'cheaper',
  'bigger',
  'smaller',
  'larger',
  'nearer',
  'closer',
  'bengaluru',
  'bangalore',
  'karnataka',
]);

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseMeasures(text: string): Measure[] {
  const measures: Measure[] = [];
  for (const match of text.matchAll(MEASURES)) {
    const value = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = match[2].toLowerCase().replace(/[.\s]/g, '');
    const area = (sqftPerUnit: number) =>
      measures.push({ kind: 'area', value: value * sqftPerUnit });
    if (/^(sqft|sqfeet|sft)$/.test(unit)) area(1);
    else if (/^sqy/.test(unit)) area(9);
    else if (/^sqm/.test(unit)) area(SQFT_PER_AREA_UNIT['Sq.Mtr.']);
    else if (/^acre/.test(unit)) area(SQFT_PER_AREA_UNIT.Acre);
    else if (/^gunt/.test(unit)) area(SQFT_PER_AREA_UNIT.Gunta);
    else if (/^cent/.test(unit)) area(SQFT_PER_AREA_UNIT.Cent);
    else if (/^ground/.test(unit)) area(SQFT_PER_AREA_UNIT.Ground);
    else if (/^cr/.test(unit))
      measures.push({ kind: 'price', value: value * 1e7 });
    else if (/^la/.test(unit))
      measures.push({ kind: 'price', value: value * 1e5 });
    else if (unit === 'bhk') measures.push({ kind: 'bhk', value });
  }
  return measures;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(a, b) * RELATIVE_TOLERANCE;
}

/** Stored land area in square feet, whichever unit the lister chose. */
function landAreaSqft(candidate: DescribedCandidate): number | null {
  const land = toNumber(candidate.land_area);
  if (land === null) return null;
  const unit = (candidate.land_area_unit || 'Sq.Ft.')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const factor = Object.entries(SQFT_PER_AREA_UNIT).find(
    ([name]) => name.toLowerCase().replace(/[^a-z]/g, '') === unit
  )?.[1];
  if (factor !== undefined) return land * factor;
  if (/yd|yard/.test(unit)) return land * 9;
  return null;
}

function satisfies(candidate: DescribedCandidate, measure: Measure): boolean {
  switch (measure.kind) {
    case 'area':
      return [
        landAreaSqft(candidate),
        toNumber(candidate.area_sqft),
        toNumber(candidate.super_built_area),
      ].some((area) => area !== null && close(area, measure.value));
    case 'price': {
      const price = toNumber(candidate.price);
      return price !== null && close(price, measure.value);
    }
    case 'bhk':
      return toNumber(candidate.bedrooms) === measure.value;
  }
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

function haystack(candidate: DescribedCandidate): Set<string> {
  return new Set(
    tokens(
      [
        candidate.title,
        candidate.location,
        candidate.sublocality,
        candidate.project,
      ]
        .filter(Boolean)
        .join(' ')
    )
  );
}

function soleWinner<T extends { id: string }>(
  scored: { candidate: T; score: number }[]
): string | null {
  const best = Math.max(0, ...scored.map((s) => s.score));
  if (best === 0) return null;
  const winners = scored.filter((s) => s.score === best);
  return winners.length === 1 ? winners[0].candidate.id : null;
}

/**
 * True when the message points at a listing by a figure — "this 40,000
 * sqft one", "the 16 Cr plot", "that 3 BHK" — or by a word of its own,
 * "No, the Chikatogur one". The figure on its own is a requirement ("I
 * want 2400 sqft", "I want one 2400 sqft plot"); the demonstrative is
 * what makes it a reference to something already in the thread.
 */
export function referencesSharedListing(
  text: string | null | undefined
): boolean {
  const value = (text || '').trim();
  if (!value) return false;
  if (!REFERENCE_MARKER.test(value)) return false;
  if (MEASURE.test(value)) return true;
  const pointer = DESCRIBED_POINTER.exec(value);
  return !!pointer && tokens(pointer[1]).length > 0;
}

/**
 * The one listing among the candidates that the text describes, or
 * null. A figure the buyer names (area, price, bedrooms) decides when
 * exactly one listing carries it, and a figure none of them carries
 * names nothing however well a word fits — "the 9000 sqft Chikatogur
 * one" is not the 40,000 sqft Chikatogur plot. Without a figure, a word
 * from the title or locality that only one listing carries decides. Two
 * listings that both fit, or none that does, name nothing — the caller
 * falls back to the thread's own subject rather than guessing.
 */
export function describedListingAmong(
  text: string | null | undefined,
  candidates: DescribedCandidate[]
): string | null {
  const value = (text || '').trim();
  if (!value || candidates.length === 0) return null;

  const measures = parseMeasures(value);
  if (measures.length > 0) {
    return soleWinner(
      candidates.map((candidate) => ({
        candidate,
        score: measures.filter((m) => satisfies(candidate, m)).length,
      }))
    );
  }

  const words = tokens(value);
  if (words.length === 0) return null;
  const stacks = candidates.map(haystack);
  return soleWinner(
    candidates.map((candidate, i) => ({
      candidate,
      score: words.filter(
        (w) => stacks[i].has(w) && stacks.every((s, j) => j === i || !s.has(w))
      ).length,
    }))
  );
}
