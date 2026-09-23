/**
 * Fuzzy locality-name matching for tiered location search.
 *
 * The same Indian locality shows up in inventory under many spellings:
 * "Suryanagar" / "Surya Nagar" / "Surya City", "Electronic City" /
 * "Electronics City Phase 1", "Bommasandra" / "Bommasandra Industrial
 * Area". Raw substring matching misses these, so matching compares
 * distinctive stem tokens instead: lowercase, split fused "…nagar(a)"
 * suffixes apart, drop generic designator words (nagar/city/layout/…)
 * that carry no place identity, and fold trailing plural "s".
 */

import { bengaluruZoneLocalities } from '@/lib/bengaluru-zones';

const DESIGNATOR_TOKENS = new Set([
  'nagar',
  'nagara',
  'city',
  'town',
  'township',
  'layout',
  'colony',
  'extension',
  'extn',
  'ext',
  'enclave',
  'residency',
  'area',
  'estate',
  'industrial',
  'phase',
  'stage',
  'block',
  'sector',
  'main',
  'cross',
  'road',
  'rd',
  'village',
  'post',
  'circle',
  'junction',
  'gate',
  'taluk',
  'hobli',
  'district',
  'khb',
]);

// Designator suffixes commonly written both fused and separate
// ("Suryanagar" ↔ "Surya Nagar"). Deliberately just these — endings
// like "halli"/"palya" are integral to the place name, and short names
// ("Srinagar") are kept whole via the minimum-remainder guard.
const FUSED_SUFFIXES = ['nagara', 'nagar'];
const MIN_FUSED_REMAINDER = 4;

const MIN_STEM_LENGTH = 2;

export function normalizeLocalityLabel(label: string): string {
  const tokens = label
    .split(',')[0]
    .replace(/[().]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const normalized: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (
      /^[a-z]$/i.test(tokens[index]) &&
      /^[a-z]$/i.test(tokens[index + 1] ?? '')
    ) {
      let initials = tokens[index];
      while (/^[a-z]$/i.test(tokens[index + 1] ?? '')) {
        index += 1;
        initials += tokens[index];
      }
      normalized.push(initials);
    } else {
      normalized.push(tokens[index]);
    }
  }

  return normalized.join(' ');
}

/** Distinctive tokens of a locality string, designators stripped. */
export function localityStems(text: string): string[] {
  const stems: string[] = [];
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!token || DESIGNATOR_TOKENS.has(token)) continue;
    let stem = token;
    for (const suffix of FUSED_SUFFIXES) {
      if (
        stem.length >= suffix.length + MIN_FUSED_REMAINDER &&
        stem.endsWith(suffix)
      ) {
        stem = stem.slice(0, -suffix.length);
        break;
      }
    }
    // "Electronics City" ↔ "Electronic City"
    if (stem.length > 3 && stem.endsWith('s')) stem = stem.slice(0, -1);
    if (stem.length >= MIN_STEM_LENGTH) stems.push(stem);
  }
  return stems;
}

/**
 * True when the search label refers to the locality named inside
 * `field` — plain substring first (previous behavior), then stem-token
 * containment so "Suryanagar" matches "Surya City Layout, Chandapura".
 */
export function textContainsLocality(field: string, label: string): boolean {
  const needle = label.toLowerCase().trim();
  if (!needle) return false;
  if (field.toLowerCase().includes(needle)) return true;

  const needleStems = localityStems(label);
  if (needleStems.length === 0) return false;
  const fieldStems = new Set(localityStems(field));
  return needleStems.every((s) => fieldStems.has(s));
}

/** Shortest stem a one-character slip is still trusted on. Below it
 *  one edit turns one place into another: HSR and HBR are both real. */
const MIN_FUZZY_STEM_LENGTH = 5;

function withinOneEdit(left: string, right: string): boolean {
  if (left === right) return true;
  const lengthDiff = left.length - right.length;
  if (Math.abs(lengthDiff) > 1) return false;

  if (lengthDiff === 0) {
    const mismatches: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) mismatches.push(index);
    }
    if (mismatches.length === 1) return true;
    // One adjacent transposition: "Whitefeild" is Whitefield.
    return (
      mismatches.length === 2 &&
      mismatches[1] === mismatches[0] + 1 &&
      left[mismatches[0]] === right[mismatches[1]] &&
      left[mismatches[1]] === right[mismatches[0]]
    );
  }

  const [shorter, longer] = lengthDiff < 0 ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

function stemHit(requested: string, candidates: string[]): boolean {
  return candidates.some(
    (candidate) =>
      candidate === requested ||
      (Math.min(requested.length, candidate.length) >= MIN_FUZZY_STEM_LENGTH &&
        withinOneEdit(requested, candidate))
  );
}

/**
 * textContainsLocality, tolerant of the way locality names are actually
 * typed: one slipped character per stem ("Kormangala", "Vijay Bank
 * Layout") and a name fused into one word or split in two
 * ("Vijayanbank layout" ↔ "Vijaya Bank Layout"). Stems shorter than
 * MIN_FUZZY_STEM_LENGTH still have to match exactly.
 */
export function textNamesLocality(field: string, label: string): boolean {
  if (textContainsLocality(field, label)) return true;

  const requested = localityStems(label);
  if (requested.length === 0) return false;
  const candidates = localityStems(field);
  if (requested.every((stem) => stemHit(stem, candidates))) return true;

  const fused = requested.join('');
  return stemHit(fused, [...candidates, candidates.join('')]);
}

/**
 * True when two locality labels name the same place, whichever of them
 * is the longer form: "Koramangala" against "Koramangala 1st Block" as
 * well as the reverse, and either spelt with a slip.
 */
export function localityLabelsMatch(
  candidate: string,
  requested: string
): boolean {
  return (
    textNamesLocality(candidate, requested) ||
    textContainsLocality(requested, candidate)
  );
}

/** Property fields the near-search name tier reads, in the order it
 *  probes them. `title` belongs here because listings routinely name
 *  the area only there ("House in Koramangala 7th phase") while
 *  `location` holds a street address that never repeats it. */
export const LOCALITY_MATCH_FIELDS = [
  'locality_canonical',
  'sublocality',
  'location',
  'project',
  'title',
] as const;

/** True when any of a property row's locality-bearing fields names the
 *  searched locality. */
export function rowMatchesLocality(
  row: Partial<Record<(typeof LOCALITY_MATCH_FIELDS)[number], string | null>>,
  label: string
): boolean {
  return LOCALITY_MATCH_FIELDS.some((field) => {
    const value = row[field];
    return !!value && textContainsLocality(value, label);
  });
}

export function localityRowPrefilter(label: string): string | null {
  const stems = localityStems(label);
  const probe = stems.length
    ? stems.reduce((a, b) => (b.length > a.length ? b : a))
    : label.trim();
  if (!probe) return null;
  const clean = probe.replace(/["\\]/g, '');
  return LOCALITY_MATCH_FIELDS.map(
    (field) => `${field}.ilike."%${clean}%"`
  ).join(',');
}

export function rowMatchesBengaluruZone(
  row: Partial<
    Record<(typeof LOCALITY_MATCH_FIELDS)[number], string | null>
  > & {
    city?: string | null;
  },
  zone: string
): boolean {
  const city = row.city?.trim().toLowerCase();
  if (city && city !== 'bengaluru' && city !== 'bangalore') return false;
  return bengaluruZoneLocalities(zone).some((locality) =>
    rowMatchesLocality(row, locality)
  );
}

/**
 * Stem usable as an extra `%stem%` ILIKE probe alongside the raw label
 * when fetching name-match candidates (e.g. "Suryanagar" → "surya",
 * which also catches "Surya City" rows). Null when the label is
 * already its own stem, is multi-stemmed, or the stem is too short to
 * be selective — over-fetching is cheap but not free, and the strict
 * in-memory check gates what actually counts as a match.
 */
export function localityStemProbe(label: string): string | null {
  const stems = localityStems(label);
  if (stems.length !== 1) return null;
  const stem = stems[0];
  if (stem.length < 4 || stem === label.toLowerCase().trim()) return null;
  return stem;
}
