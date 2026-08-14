// ============================================================
// Relative size feedback — "Looking for lesser dimensions".
//
// A buyer answering a shortlist in terms of the listing in front of
// them states no number, so the extraction (told never to guess) can
// file nothing. The words still carry a bound: smaller than THAT. The
// ladder anchors it to the listing the thread is pinned to — the max
// becomes 90% of the shown plot's area, or the min 110% for "bigger" —
// which is what finally lets "lesser dimensions" drop a 4,200 sq.ft.
// plot out of the ranking instead of re-serving it.
//
// Pure text; the anchoring itself lives with the ladder, which holds
// the listing.
// ============================================================

export type RelativeSizeSignal = 'smaller' | 'bigger';

const SIZE_NOUN =
  '(?:dimensions?|size[sd]?|extent|area|plot|site|sqft|sq\\.?\\s*ft)';

// The bare adjectives read as size only when they are not qualifying
// money — "smaller budget" is budget feedback, and this parser claiming
// it would anchor a size bound off a message about price.
const MONEY_NOUN = '(?:budget|price|amount|cost|rate|rent)';

const SMALLER = new RegExp(
  `\\b(?:smaller(?!\\s+${MONEY_NOUN})|too\\s+(?:big|large|huge)|(?:lesser|less|lower|reduced)\\s+${SIZE_NOUN})\\b`,
  'i'
);

const BIGGER = new RegExp(
  `\\b(?:(?:bigger|larger)(?!\\s+${MONEY_NOUN})|too\\s+small|(?:more|higher|greater)\\s+${SIZE_NOUN})\\b`,
  'i'
);

/** How far the derived bound sits from the shown listing's own size.
 *  Chosen against the matcher's ±10% near-miss band so the anchor
 *  listing itself can never crawl back in as a "partial":
 *  0.85 × 1.1 < 1 on the way down, and (1/0.85) × 0.9 > 1 on the way
 *  up. A test holds both inequalities. */
export const SIZE_ANCHOR_RATIO = 0.85;

export function parseRelativeSizeSignal(
  text?: string | null
): RelativeSizeSignal | null {
  const value = (text || '').trim();
  if (!value) return null;
  if (SMALLER.test(value)) return 'smaller';
  if (BIGGER.test(value)) return 'bigger';
  return null;
}

/**
 * Folds the anchored bound into an extraction. A figure the lead
 * actually stated stays authoritative — the anchor only ever tightens —
 * and the opposite bound is dropped rather than left crossing the new
 * one, which would store a band nothing can satisfy.
 */
export function applySizeAnchor<
  T extends {
    land_area_min_sqft: number | null;
    land_area_max_sqft: number | null;
  },
>(prefs: T, signal: RelativeSizeSignal | null, anchorSqft: number | null): T {
  if (!signal || !anchorSqft || anchorSqft <= 0) return prefs;
  if (signal === 'smaller') {
    const cap = Math.round(anchorSqft * SIZE_ANCHOR_RATIO);
    const max =
      prefs.land_area_max_sqft != null
        ? Math.min(prefs.land_area_max_sqft, cap)
        : cap;
    const min =
      prefs.land_area_min_sqft != null && prefs.land_area_min_sqft > max
        ? null
        : prefs.land_area_min_sqft;
    return { ...prefs, land_area_min_sqft: min, land_area_max_sqft: max };
  }
  const floor = Math.round(anchorSqft / SIZE_ANCHOR_RATIO);
  const min =
    prefs.land_area_min_sqft != null
      ? Math.max(prefs.land_area_min_sqft, floor)
      : floor;
  const max =
    prefs.land_area_max_sqft != null && prefs.land_area_max_sqft < min
      ? null
      : prefs.land_area_max_sqft;
  return { ...prefs, land_area_min_sqft: min, land_area_max_sqft: max };
}
