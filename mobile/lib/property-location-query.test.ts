import { describe, expect, it } from 'vitest';

import { appendLocationFilters } from './property-location-query';

describe('appendLocationFilters', () => {
  it('writes each selected locality as a repeated location parameter', () => {
    const params = appendLocationFilters(new URLSearchParams(), [
      'Whitefield',
      'Koramangala',
    ]);

    expect(params.getAll('location')).toEqual(['Whitefield', 'Koramangala']);
  });

  it('omits blank and duplicate localities', () => {
    const params = appendLocationFilters(new URLSearchParams(), [
      'Whitefield',
      ' whitefield ',
      '',
      'Koramangala',
    ]);

    expect(params.getAll('location')).toEqual(['Whitefield', 'Koramangala']);
  });
});
