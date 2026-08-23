import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHOWCASE_STYLE,
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
});
