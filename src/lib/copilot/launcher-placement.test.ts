import { describe, expect, it } from 'vitest';
import {
  clampLauncherBottom,
  isLauncherDrag,
  nudgeAnchor,
  parseLauncherPlacement,
  snapLauncher,
} from './launcher-placement';

const viewport = { width: 1200, height: 800 };

describe('[CPL-001] copilot launcher placement', () => {
  it('snaps to whichever edge the launcher is dropped nearer', () => {
    expect(
      snapLauncher({ left: 200, width: 150, bottom: 500, height: 48 }, viewport)
    ).toEqual({ side: 'left', bottom: 300 });
    expect(
      snapLauncher({ left: 700, width: 150, bottom: 700, height: 48 }, viewport)
    ).toEqual({ side: 'right', bottom: 100 });
  });

  it('keeps the launcher on screen and clear of the header', () => {
    expect(clampLauncherBottom(-40, 800, 48)).toBe(16);
    expect(clampLauncherBottom(5000, 800, 48)).toBe(800 - 80 - 48);
    expect(clampLauncherBottom(200, 100, 48)).toBe(16);
  });

  it('treats a small wobble as a click, not a drag', () => {
    expect(isLauncherDrag(3, 4)).toBe(false);
    expect(isLauncherDrag(10, 0)).toBe(true);
  });

  it('restores only a well-formed saved placement', () => {
    expect(parseLauncherPlacement('{"side":"left","bottom":240}')).toEqual({
      side: 'left',
      bottom: 240,
    });
    expect(parseLauncherPlacement('{"side":"left"}')).toBeNull();
    expect(parseLauncherPlacement('{oops')).toBeNull();
    expect(parseLauncherPlacement(null)).toBeNull();
  });

  it('opens the nudge below the launcher once it sits in the top half', () => {
    expect(nudgeAnchor(160, 800)).toEqual({ bottom: 224 });
    expect(nudgeAnchor(672, 800)).toEqual({ top: 136 });
  });
});
