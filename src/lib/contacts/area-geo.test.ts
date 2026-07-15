import { describe, expect, it } from 'vitest';
import { pruneAreasGeo, sanitizeAreasGeo } from './area-geo';

describe('sanitizeAreasGeo', () => {
  it('accepts well-formed entries and trims names', () => {
    expect(
      sanitizeAreasGeo([{ name: ' HSR Layout ', lat: 12.91, lng: 77.64 }])
    ).toEqual([{ name: 'HSR Layout', lat: 12.91, lng: 77.64 }]);
  });

  it('rejects non-arrays and malformed entries', () => {
    expect(sanitizeAreasGeo(null)).toEqual([]);
    expect(sanitizeAreasGeo('HSR')).toEqual([]);
    expect(
      sanitizeAreasGeo([
        null,
        'HSR',
        { name: '', lat: 12.9, lng: 77.6 },
        { name: 'No coords' },
        { name: 'String coords', lat: '12.9', lng: '77.6' },
        { name: 'NaN', lat: NaN, lng: 77.6 },
        { name: 'Out of range', lat: 91, lng: 77.6 },
        { name: 'Out of range lng', lat: 12.9, lng: 181 },
      ])
    ).toEqual([]);
  });

  it('keeps the first occurrence of duplicate names (case-insensitive)', () => {
    expect(
      sanitizeAreasGeo([
        { name: 'HSR Layout', lat: 12.91, lng: 77.64 },
        { name: 'hsr layout', lat: 1, lng: 2 },
      ])
    ).toEqual([{ name: 'HSR Layout', lat: 12.91, lng: 77.64 }]);
  });
});

describe('pruneAreasGeo', () => {
  it('drops entries whose area was removed from the list', () => {
    const geo = [
      { name: 'HSR Layout', lat: 12.91, lng: 77.64 },
      { name: 'Whitefield', lat: 12.97, lng: 77.75 },
    ];
    expect(pruneAreasGeo(geo, ['whitefield'])).toEqual([
      { name: 'Whitefield', lat: 12.97, lng: 77.75 },
    ]);
    expect(pruneAreasGeo(geo, [])).toEqual([]);
  });
});
