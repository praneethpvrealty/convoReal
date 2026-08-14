import { describe, expect, it } from 'vitest';

import {
  applySizeAnchor,
  parseRelativeSizeSignal,
  SIZE_ANCHOR_RATIO,
} from './size-feedback';

// "Looking for lesser dimensions" was answered with the same 4,200
// sq.ft. plot it was rejecting, because the words carry no figure and
// the extraction is told never to guess. These pin the signal reader
// and the anchoring that turns those words into a bound the matcher
// can act on.

describe('parseRelativeSizeSignal', () => {
  it.each([
    ['Looking for lesser dimensions', 'smaller'],
    ['smaller plot please', 'smaller'],
    ['this is too big for us', 'smaller'],
    ['too large', 'smaller'],
    ['need less area', 'smaller'],
    ['something bigger', 'bigger'],
    ['larger site', 'bigger'],
    ['too small for our plans', 'bigger'],
    ['more extent needed', 'bigger'],
  ])('%s → %s', (text, expected) => {
    expect(parseRelativeSizeSignal(text)).toBe(expected);
  });

  it.each([
    // A figure is the extraction's job, not this parser's.
    ['need a 30x40 site', null],
    ['under 2400 sqft', null],
    // Ordinary traffic must never read as size feedback.
    ['is the price negotiable', null],
    ['smaller budget', null],
    ['looking for commercial land', null],
    ['lesser known areas are fine', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%s → null', (text, expected) => {
    expect(parseRelativeSizeSignal(text)).toBe(expected);
  });
});

describe('applySizeAnchor', () => {
  const empty: {
    land_area_min_sqft: number | null;
    land_area_max_sqft: number | null;
  } = {
    land_area_min_sqft: null,
    land_area_max_sqft: null,
  };

  it('caps below the shown listing on "smaller"', () => {
    const out = applySizeAnchor(empty, 'smaller', 4200);
    expect(out.land_area_max_sqft).toBe(Math.round(4200 * SIZE_ANCHOR_RATIO));
    expect(out.land_area_min_sqft).toBeNull();
  });

  it('sits the cap outside the matcher tolerance, so the rejected plot cannot crawl back as a partial', () => {
    // The matcher's near-miss band is ±10% (matching.ts). Both
    // directions must leave the anchor listing strictly outside it.
    const down = applySizeAnchor(empty, 'smaller', 4200);
    expect(4200).toBeGreaterThan((down.land_area_max_sqft as number) * 1.1);
    const up = applySizeAnchor(empty, 'bigger', 4200);
    expect(4200).toBeLessThan((up.land_area_min_sqft as number) * 0.9);
  });

  it('floors above the shown listing on "bigger"', () => {
    const out = applySizeAnchor(empty, 'bigger', 1200);
    expect(out.land_area_min_sqft).toBe(Math.round(1200 / SIZE_ANCHOR_RATIO));
    expect(out.land_area_max_sqft).toBeNull();
  });

  it('only ever tightens a figure the lead actually stated', () => {
    const stated = { land_area_min_sqft: null, land_area_max_sqft: 3000 };
    expect(applySizeAnchor(stated, 'smaller', 4200).land_area_max_sqft).toBe(
      3000
    );
    expect(applySizeAnchor(stated, 'smaller', 2000).land_area_max_sqft).toBe(
      Math.round(2000 * SIZE_ANCHOR_RATIO)
    );
  });

  it('drops the opposite bound rather than storing an empty band', () => {
    const crossed = { land_area_min_sqft: 4000, land_area_max_sqft: null };
    const out = applySizeAnchor(crossed, 'smaller', 4200);
    expect(out.land_area_min_sqft).toBeNull();
    expect(out.land_area_max_sqft).toBe(Math.round(4200 * SIZE_ANCHOR_RATIO));
  });

  it('is a no-op without a signal or an anchor', () => {
    expect(applySizeAnchor(empty, null, 4200)).toEqual(empty);
    expect(applySizeAnchor(empty, 'smaller', null)).toEqual(empty);
    expect(applySizeAnchor(empty, 'smaller', 0)).toEqual(empty);
  });
});
