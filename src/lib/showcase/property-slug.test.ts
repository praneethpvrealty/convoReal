import { describe, expect, it } from 'vitest';
import { propertyLookupKeyFromSlug, propertySlug } from './property-slug';

const ID = '3f2c8a1e-4b6d-4f0a-9c2e-8d7b6a5f4e3d';

describe('propertySlug', () => {
  it('builds a keyworded slug ending in the listing id', () => {
    expect(
      propertySlug({
        id: ID,
        title: '3 BHK Apartment',
        sublocality: 'Whitefield',
        city: 'Bengaluru',
      })
    ).toBe(`3-bhk-apartment-whitefield-${ID}`);
  });

  it('falls back to city when sublocality is missing', () => {
    expect(propertySlug({ id: ID, title: 'Farm Land', city: 'Coorg' })).toBe(
      `farm-land-coorg-${ID}`
    );
  });

  it('strips symbols and collapses separators', () => {
    expect(propertySlug({ id: ID, title: '  Villa @ Palm — Grove!! ' })).toBe(
      `villa-palm-grove-${ID}`
    );
  });

  it('returns the bare id when no words survive slugification', () => {
    expect(propertySlug({ id: ID, title: '###' })).toBe(ID);
  });
});

describe('propertyLookupKeyFromSlug', () => {
  it('extracts the trailing uuid from a keyworded slug', () => {
    expect(propertyLookupKeyFromSlug(`3-bhk-apartment-whitefield-${ID}`)).toBe(
      ID
    );
  });

  it('accepts a bare uuid', () => {
    expect(propertyLookupKeyFromSlug(ID.toUpperCase())).toBe(ID);
  });

  it('passes through property codes untouched', () => {
    expect(propertyLookupKeyFromSlug('PROP-1042')).toBe('PROP-1042');
  });

  it('decodes url-encoded slugs', () => {
    expect(propertyLookupKeyFromSlug(`villa%2Dpalm-${ID}`)).toBe(ID);
  });
});
