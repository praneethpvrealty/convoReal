import { describe, it, expect } from 'vitest';
import {
  audienceListingLabel,
  filterAudienceListings,
  reachableAudienceIds,
} from './listing-audience-select';
import type { AudienceContact } from '@shared/lib/inventory/listing-audience';

function member(overrides: Partial<AudienceContact> = {}): AudienceContact {
  return {
    contactId: 'c1',
    name: 'Asha',
    phone: '919000000001',
    classification: 'Buyer',
    nameTag: null,
    enquired: true,
    viewed: false,
    viewsCount: 0,
    lastAt: null,
    ...overrides,
  };
}

describe('audienceListingLabel', () => {
  it('prefers the code, falls back to the title', () => {
    const base = { propertyId: 'p1', contactsCount: 1, lastAt: null };
    expect(
      audienceListingLabel({ ...base, title: 'Villa', propertyCode: 'CR-1' })
    ).toBe('CR-1');
    expect(
      audienceListingLabel({ ...base, title: 'Villa', propertyCode: null })
    ).toBe('Villa');
    expect(
      audienceListingLabel({ ...base, title: null, propertyCode: null })
    ).toBe('Untitled listing');
  });
});

describe('reachableAudienceIds', () => {
  it('keeps only members the match list can select', () => {
    const { ids, unreachable } = reachableAudienceIds(
      [member({ contactId: 'c1' }), member({ contactId: 'c2' })],
      [{ id: 'c1', phone: '919000000001' }]
    );
    expect(ids).toEqual(['c1']);
    expect(unreachable).toBe(1);
  });

  it('drops a member with no number on either side', () => {
    const { ids, unreachable } = reachableAudienceIds(
      [member({ contactId: 'c1', phone: null })],
      [{ id: 'c1', phone: null }]
    );
    expect(ids).toEqual([]);
    expect(unreachable).toBe(1);
  });
});

describe('filterAudienceListings', () => {
  const listings = [
    { propertyId: 'p1', title: 'Villa in Whitefield', propertyCode: 'CR-1', contactsCount: 3, lastAt: null },
    { propertyId: 'p2', title: 'Plot in HSR', propertyCode: 'PROP-1095', contactsCount: 70, lastAt: null },
    { propertyId: 'p3', title: null, propertyCode: null, contactsCount: 1, lastAt: null },
  ];

  it('returns everything for an empty or whitespace query', () => {
    expect(filterAudienceListings(listings, '')).toHaveLength(3);
    expect(filterAudienceListings(listings, '   ')).toHaveLength(3);
  });

  it('matches on title, case-insensitively', () => {
    expect(filterAudienceListings(listings, 'whitefield').map((l) => l.propertyId)).toEqual(['p1']);
  });

  it('matches on property code', () => {
    expect(filterAudienceListings(listings, 'prop-10').map((l) => l.propertyId)).toEqual(['p2']);
  });

  it('survives listings with no title or code', () => {
    expect(filterAudienceListings(listings, 'zzz')).toEqual([]);
  });
});
