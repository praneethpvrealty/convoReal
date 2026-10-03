import { describe, expect, it } from 'vitest';

import {
  BOARD_LAYOUTS,
  DEFAULT_BOARD_LAYOUT,
  parseBoardLayout,
} from './board-layout';

describe('[PIPE-001] the board opens flat and remembers the wheel', () => {
  it('defaults to the flat row', () => {
    expect(DEFAULT_BOARD_LAYOUT).toBe('flat');
    expect(BOARD_LAYOUTS.map((l) => l.id)).toEqual(['flat', 'wheel']);
  });

  it('accepts only the two layouts and falls back to flat', () => {
    expect(parseBoardLayout('wheel')).toBe('wheel');
    expect(parseBoardLayout('flat')).toBe('flat');
    expect(parseBoardLayout(null)).toBe('flat');
    expect(parseBoardLayout(undefined)).toBe('flat');
    expect(parseBoardLayout('carousel')).toBe('flat');
  });
});
