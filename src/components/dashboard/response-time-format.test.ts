import { describe, expect, it } from 'vitest';

import { durationUnit, formatDuration } from './response-time-format';

describe('formatDuration', () => {
  it('picks seconds, minutes or hours by magnitude', () => {
    expect(formatDuration(0.75)).toBe('45s');
    expect(formatDuration(5.2)).toBe('5.2m');
    expect(formatDuration(5)).toBe('5m');
    expect(formatDuration(66)).toBe('1.1h');
    expect(formatDuration(null)).toBe('—');
  });

  it('keeps small axis ticks distinct instead of collapsing to 0.0m', () => {
    const unit = durationUnit(0.4);
    expect([0, 0.1, 0.2, 0.3, 0.4].map((v) => formatDuration(v, unit))).toEqual(
      ['0s', '6s', '12s', '18s', '24s']
    );
  });

  it('formats a pair in one unit when given the larger value’s unit', () => {
    const unit = durationUnit(Math.max(66, 52.4));
    expect(formatDuration(66, unit)).toBe('1.1h');
    expect(formatDuration(52.4, unit)).toBe('0.9h');
  });
});
