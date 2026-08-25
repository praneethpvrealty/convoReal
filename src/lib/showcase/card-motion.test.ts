import { describe, expect, it } from 'vitest';

import { showcaseCardMotion } from '@/lib/showcase/card-motion';

describe('showcase card motion', () => {
  it('keeps desktop cards rectangular while moving them through depth', () => {
    expect(showcaseCardMotion(1, false)).toEqual({
      rotateXDegrees: 0,
      translateYPercent: 1.25,
      translateZPixels: -42,
      scale: 0.988,
      opacity: 0.92,
    });
    expect(showcaseCardMotion(-1, false).rotateXDegrees).toBe(0);
  });

  it('keeps mobile cards stable and fully readable', () => {
    expect(showcaseCardMotion(1, true)).toEqual({
      rotateXDegrees: 0,
      translateYPercent: 0,
      translateZPixels: 0,
      scale: 1,
      opacity: 1,
    });
  });

  it('clamps motion beyond the visible range', () => {
    expect(showcaseCardMotion(4, false)).toEqual(
      showcaseCardMotion(1, false)
    );
  });
});
