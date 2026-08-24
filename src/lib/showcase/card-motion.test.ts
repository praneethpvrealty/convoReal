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

  it('retains the stronger vertical flip in the mobile deck', () => {
    expect(showcaseCardMotion(1, true)).toEqual({
      rotateXDegrees: -68,
      translateYPercent: 10,
      translateZPixels: -180,
      scale: 0.88,
      opacity: 0.38,
    });
  });

  it('clamps motion beyond the visible range', () => {
    expect(showcaseCardMotion(4, false)).toEqual(
      showcaseCardMotion(1, false)
    );
  });
});
