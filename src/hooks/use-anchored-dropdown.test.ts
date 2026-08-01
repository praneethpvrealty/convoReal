import { describe, it, expect } from 'vitest';
import { computeAnchoredPosition } from './use-anchored-dropdown';

const viewport = { width: 1440, height: 900 };

describe('computeAnchoredPosition', () => {
  it('opens below the anchor when there is room', () => {
    const pos = computeAnchoredPosition(
      { top: 100, bottom: 140, left: 200, width: 320 },
      viewport
    );
    expect(pos.top).toBe(146);
    expect(pos.left).toBe(200);
    expect(pos.width).toBe(320);
    expect(pos.maxHeight).toBe(360);
  });

  it('flips above the anchor when the anchor sits near the bottom edge', () => {
    const pos = computeAnchoredPosition(
      { top: 800, bottom: 840, left: 200, width: 320 },
      viewport
    );
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(800);
    expect(pos.maxHeight).toBe(360);
  });

  it('keeps the panel inside the viewport when neither side fits', () => {
    const pos = computeAnchoredPosition(
      { top: 180, bottom: 220, left: 200, width: 320 },
      { width: 1440, height: 420 }
    );
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(412);
  });

  it('ignores page scroll offsets because the panel is viewport-fixed', () => {
    const scrolled = computeAnchoredPosition(
      { top: 100, bottom: 140, left: 200, width: 320 },
      viewport
    );
    expect(scrolled.top).toBe(146);
  });

  it('clamps a right-edge anchor back inside the viewport', () => {
    const pos = computeAnchoredPosition(
      { top: 100, bottom: 140, left: 1300, width: 320 },
      viewport
    );
    expect(pos.left).toBe(1440 - 320 - 8);
  });
});
