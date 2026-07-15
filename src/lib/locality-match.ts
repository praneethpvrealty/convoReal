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

const DESIGNATOR_TOKENS = new Set([
  'nagar', 'nagara', 'city', 'town', 'township', 'layout', 'colony',
  'extension', 'extn', 'ext', 'enclave', 'residency', 'area', 'estate',
  'industrial', 'phase', 'stage', 'block', 'sector', 'main', 'cross',
  'road', 'rd', 'village', 'post', 'circle', 'junction', 'gate',
  'taluk', 'hobli', 'district',
]);

// Designator suffixes commonly written both fused and separate
// ("Suryanagar" ↔ "Surya Nagar"). Deliberately just these — endings
// like "halli"/"palya" are integral to the place name, and short names
// ("Srinagar") are kept whole via the minimum-remainder guard.
const FUSED_SUFFIXES = ['nagara', 'nagar'];
const MIN_FUSED_REMAINDER = 4;

const MIN_STEM_LENGTH = 2;

/** Distinctive tokens of a locality string, designators stripped. */
export function localityStems(text: string): string[] {
  const stems: string[] = [];
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!token || DESIGNATOR_TOKENS.has(token)) continue;
    let stem = token;
    for (const suffix of FUSED_SUFFIXES) {
      if (stem.length >= suffix.length + MIN_FUSED_REMAINDER && stem.endsWith(suffix)) {
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
