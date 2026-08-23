import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHOWCASE_STYLE,
  resolveShowcasePresentation,
  SHOWCASE_STYLES,
  toShowcaseStyle,
} from '@/lib/showcase/style';

describe('showcase style', () => {
  it.each(SHOWCASE_STYLES)('accepts %s', (style) => {
    expect(toShowcaseStyle(style)).toBe(style);
  });

  it.each([undefined, null, '', 'three-dimensional', 3])(
    'falls back for %s',
    (value) => {
      expect(toShowcaseStyle(value)).toBe(DEFAULT_SHOWCASE_STYLE);
    }
  );

  it('uses company presentation for the company showcase', () => {
    expect(
      resolveShowcasePresentation({
        showcase_style: 'editorial',
        showcase_3d_enabled: false,
      })
    ).toEqual({ style: 'editorial', threeDimensional: false });
  });

  it('keeps a personal agent presentation independent from the company', () => {
    expect(
      resolveShowcasePresentation(
        { showcase_style: 'editorial', showcase_3d_enabled: false },
        { showcase_style: 'spotlight', showcase_3d_enabled: true }
      )
    ).toEqual({ style: 'spotlight', threeDimensional: true });
  });

  it('defaults new showcases to gallery with 3D enabled', () => {
    expect(resolveShowcasePresentation(null)).toEqual({
      style: DEFAULT_SHOWCASE_STYLE,
      threeDimensional: true,
    });
  });
});
