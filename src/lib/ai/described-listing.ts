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
  | { kind: 'sqft'; value: number }
  | { kind: 'acre'; value: number }
  | { kind: 'price'; value: number }
  | { kind: 'bhk'; value: number };

const MEASURE =
  /(\d[\d,]*(?:\.\d+)?)\s*(sq\.?\s*(?:ft|feet)|sqft|sft|sq\.?\s*(?:yds?|yards?)|sqyds?|acres?|guntas?|gunthas?|cents?|cr|crores?|lakhs?|lacs?|bhk)\b/gi;

const REFERENCE_MARKER =
  /\b(this|that|these|those|one|other|same|above|earlier|previous|former|latter|meant)\b/i;

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
  for (const match of text.matchAll(MEASURE)) {
    const value = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = match[2].toLowerCase().replace(/[.\s]/g, '');
    if (/^(sqft|sqfeet|sft)$/.test(unit))
      measures.push({ kind: 'sqft', value });
    else if (/^sqy/.test(unit))
      measures.push({ kind: 'sqft', value: value * 9 });
    else if (/^acre/.test(unit)) measures.push({ kind: 'acre', value });
    else if (/^gunt/.test(unit))
      measures.push({ kind: 'acre', value: value / 40 });
    else if (/^cent/.test(unit))
      measures.push({ kind: 'acre', value: value / 100 });
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

function landAreaIn(candidate: DescribedCandidate, kind: 'sqft' | 'acre') {
  const land = toNumber(candidate.land_area);
  if (land === null) return null;
  const unit = (candidate.land_area_unit || '').toLowerCase();
  const inAcres = /acre/.test(unit);
  if (kind === 'acre') return inAcres ? land : null;
  return inAcres || /yd|yard|gunta|cent|ground/.test(unit) ? null : land;
}

function satisfies(candidate: DescribedCandidate, measure: Measure): boolean {
  switch (measure.kind) {
    case 'sqft':
      return [
        landAreaIn(candidate, 'sqft'),
        toNumber(candidate.area_sqft),
        toNumber(candidate.super_built_area),
      ].some((area) => area !== null && close(area, measure.value));
    case 'acre': {
      const land = landAreaIn(candidate, 'acre');
      return land !== null && close(land, measure.value);
    }
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
 * sqft one", "the 16 Cr plot", "that 3 BHK". The figure on its own is
 * a requirement ("I want 2400 sqft"); the demonstrative is what makes
 * it a reference to something already in the thread.
 */
export function referencesSharedListing(
  text: string | null | undefined
): boolean {
  const value = (text || '').trim();
  if (!value) return false;
  if (!REFERENCE_MARKER.test(value)) return false;
  MEASURE.lastIndex = 0;
  return MEASURE.test(value);
}

/**
 * The one listing among the candidates that the text describes, or
 * null. A figure the buyer names (area, price, bedrooms) decides when
 * exactly one listing carries it; failing that, a word from the title
 * or locality that only one listing carries. Two listings that both
 * fit, or none that does, name nothing — the caller falls back to the
 * thread's own subject rather than guessing.
 */
export function describedListingAmong(
  text: string | null | undefined,
  candidates: DescribedCandidate[]
): string | null {
  const value = (text || '').trim();
  if (!value || candidates.length === 0) return null;

  const measures = parseMeasures(value);
  if (measures.length > 0) {
    const byFigure = soleWinner(
      candidates.map((candidate) => ({
        candidate,
        score: measures.filter((m) => satisfies(candidate, m)).length,
      }))
    );
    if (byFigure) return byFigure;
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
