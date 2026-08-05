import { describe, expect, it } from 'vitest';

import { anchoredMenuLayout } from './anchored-menu';

const base = {
  menuWidth: 250,
  contentHeight: 200,
  frameWidth: 400,
  frameHeight: 800,
};

describe('anchoredMenuLayout', () => {
  it('centres the menu on the press point when there is room', () => {
    const { left, top } = anchoredMenuLayout({ ...base, anchorX: 200, anchorY: 100 });
    expect(left).toBe(75);
    expect(top).toBe(114);
  });

  it('keeps the menu inside the left and right margins', () => {
    expect(anchoredMenuLayout({ ...base, anchorX: 0, anchorY: 100 }).left).toBe(12);
    expect(anchoredMenuLayout({ ...base, anchorX: 400, anchorY: 100 }).left).toBe(138);
  });

  it('flips above the anchor when the menu would overflow the bottom', () => {
    const { top } = anchoredMenuLayout({ ...base, anchorX: 200, anchorY: 700 });
    expect(top).toBe(486);
    expect(top + base.contentHeight).toBeLessThanOrEqual(700);
  });

  it('picks the roomier side when the menu fits on neither', () => {
    const near = anchoredMenuLayout({
      ...base,
      contentHeight: 600,
      frameHeight: 400,
      anchorX: 200,
      anchorY: 300,
    });
    expect(near.top).toBe(12);
    expect(near.maxHeight).toBe(274);

    const far = anchoredMenuLayout({
      ...base,
      contentHeight: 600,
      frameHeight: 400,
      anchorX: 200,
      anchorY: 100,
    });
    expect(far.top).toBe(114);
    expect(far.maxHeight).toBe(274);
  });

  it('caps maxHeight to the room on the chosen side so a long menu scrolls', () => {
    const { maxHeight } = anchoredMenuLayout({
      ...base,
      contentHeight: 900,
      anchorX: 200,
      anchorY: 100,
    });
    expect(maxHeight).toBe(674);
    expect(maxHeight).toBeLessThan(900);
  });

  it('never returns a negative height or a top above the margin', () => {
    const { top, maxHeight } = anchoredMenuLayout({
      ...base,
      frameHeight: 20,
      anchorX: 200,
      anchorY: 18,
    });
    expect(maxHeight).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(12);
  });

  it('clamps an anchor left outside the frame by a rotation or fold', () => {
    const { top, maxHeight } = anchoredMenuLayout({
      ...base,
      contentHeight: 584,
      frameHeight: 360,
      anchorX: 200,
      anchorY: 700,
    });
    expect(maxHeight).toBe(334);
    expect(top).toBe(12);
    expect(top + Math.min(584, maxHeight)).toBeLessThanOrEqual(360);
  });

  it('stays on screen for every anchor down a short landscape window', () => {
    for (let y = -40; y <= 420; y += 20) {
      const { top, maxHeight } = anchoredMenuLayout({
        ...base,
        contentHeight: 288,
        frameHeight: 360,
        anchorX: 200,
        anchorY: y,
      });
      const height = Math.min(288, maxHeight);
      expect(top).toBeGreaterThanOrEqual(12);
      expect(top + height).toBeLessThanOrEqual(360);
    }
  });
});
