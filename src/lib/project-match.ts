/**
 * Named-project matching.
 *
 * Buyers name a project the way they say it, not the way the builder
 * registers it: "Purva Westend" for "Puravankara Westend", "Sobha" for
 * "Shobha". Locality matching (src/lib/locality-match.ts) compares
 * stem tokens, which covers spelling drift inside a word but not a
 * brand written short. This adds one step on top, for project names
 * only: two stems also agree when the shorter one's consonant skeleton
 * opens the longer one's ("purva" → prv, "puravankara" → prvnkr).
 *
 * Deliberately not folded into locality matching — loosening area
 * comparison would change matching for every contact, not just the
 * ones who named a project.
 */

import { localityStems, textContainsLocality } from './locality-match';

/** Shortest skeleton allowed to stand in for a longer name. Two
 *  consonants abbreviate far too much to be evidence of anything. */
const MIN_ABBREVIATION_SKELETON = 3;
/** A shared spine of the same length is a spelling variant rather than
 *  an abbreviation ("sobha"/"shobha" → sb), so it can be shorter — but
 *  never one consonant, which every vowel-heavy name would collide on. */
const MIN_VARIANT_SKELETON = 2;
/** Below this a stem is too small to be anyone's brand shorthand. */
const MIN_SHORT_STEM_LENGTH = 4;

/**
 * Consonant spine of a stem: vowels carry no brand identity across
 * transliterations, aspirated pairs ("bh"/"sh") are one sound written
 * two ways, and a doubled letter is a spelling choice.
 */
export function consonantSkeleton(stem: string): string {
  let skeleton = '';
  for (const char of stem.replace(/[aeiou]/g, '')) {
    if (char === 'h' && skeleton.length > 0) continue;
    const folded = char === 'w' ? 'v' : char;
    if (folded === skeleton[skeleton.length - 1]) continue;
    skeleton += folded;
  }
  return skeleton;
}

function stemsAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < MIN_SHORT_STEM_LENGTH) return false;

  const shortSkeleton = consonantSkeleton(short);
  const longSkeleton = consonantSkeleton(long);
  if (!longSkeleton.startsWith(shortSkeleton)) return false;

  return shortSkeleton.length >= (shortSkeleton === longSkeleton
    ? MIN_VARIANT_SKELETON
    : MIN_ABBREVIATION_SKELETON);
}

/**
 * True when `field` (a property's project or title) names the project
 * the buyer asked for. Exact and stem matching first — same answers
 * locality matching gives — then the brand-shorthand step.
 */
export function textContainsProject(field: string, label: string): boolean {
  if (textContainsLocality(field, label)) return true;

  const labelStems = localityStems(label);
  if (labelStems.length === 0) return false;
  const fieldStems = localityStems(field);
  if (fieldStems.length === 0) return false;

  return labelStems.every((wanted) => fieldStems.some((found) => stemsAgree(wanted, found)));
}
