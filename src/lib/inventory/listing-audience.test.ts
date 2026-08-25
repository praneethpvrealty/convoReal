import { describe, it, expect } from 'vitest';
import {
  audienceListingLabel,
  filterAudienceListings,
  audienceReasonLabel,
  mapAudienceContacts,
  mapAudienceListings,
  reachableAudienceIds,
  type AudienceContact,
} from './listing-audience';

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
    lastAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('mapAudienceListings', () => {
  it('coerces bigint counts arriving as strings', () => {
    expect(
      mapAudienceListings([
        {
          property_id: 'p1',
          title: 'Villa',
          property_code: 'CR-1',
          contacts_count: '7',
          last_at: '2026-08-01T00:00:00Z',
        },
      ])
    ).toEqual([
      {
        propertyId: 'p1',
        title: 'Villa',
        propertyCode: 'CR-1',
        contactsCount: 7,
        lastAt: '2026-08-01T00:00:00Z',
      },
    ]);
  });
});

describe('mapAudienceContacts', () => {
  it('defaults missing engagement flags and counts', () => {
    const [row] = mapAudienceContacts([
      {
        contact_id: 'c1',
        name: null,
        phone: null,
        classification: null,
        name_tag: null,
        enquired: null,
        viewed: null,
        views_count: null,
        last_at: null,
      },
    ]);
    expect(row.enquired).toBe(false);
    expect(row.viewed).toBe(false);
    expect(row.viewsCount).toBe(0);
  });
});

describe('audienceReasonLabel', () => {
  it('names both sources when a contact enquired and viewed', () => {
    expect(audienceReasonLabel(member({ viewed: true, viewsCount: 3 }))).toBe(
      'Enquired · 3 views'
    );
  });

  it('says "Viewed" for a single view', () => {
    expect(
      audienceReasonLabel(
        member({ enquired: false, viewed: true, viewsCount: 1 })
      )
    ).toBe('Viewed');
  });
});

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
  it('keeps only audience members the caller can select', () => {
    const audience = [
      member({ contactId: 'c1' }),
      member({ contactId: 'c2' }),
      member({ contactId: 'c3', phone: null }),
    ];
    const { ids, unreachable } = reachableAudienceIds(audience, [
      { id: 'c1', phone: '919000000001' },
      { id: 'c3', phone: null },
    ]);
    expect(ids).toEqual(['c1']);
    expect(unreachable).toBe(2);
  });

  it('accepts a phone that only the audience row carries', () => {
    const { ids, unreachable } = reachableAudienceIds(
      [member({ contactId: 'c1', phone: '919000000001' })],
      [{ id: 'c1' }]
    );
    expect(ids).toEqual(['c1']);
    expect(unreachable).toBe(0);
  });

  it('returns nothing for an empty audience', () => {
    expect(reachableAudienceIds([], [{ id: 'c1', phone: '9' }])).toEqual({
      ids: [],
      unreachable: 0,
    });
  });
});

describe('filterAudienceListings', () => {
  const listings = [
    {
      propertyId: 'p1',
      title: 'Villa in Whitefield',
      propertyCode: 'CR-1',
      contactsCount: 3,
      lastAt: null,
    },
    {
      propertyId: 'p2',
      title: 'Plot in HSR',
      propertyCode: 'PROP-1095',
      contactsCount: 70,
      lastAt: null,
    },
    {
      propertyId: 'p3',
      title: null,
      propertyCode: null,
      contactsCount: 1,
      lastAt: null,
    },
  ];

  it('returns everything for an empty or whitespace query', () => {
    expect(filterAudienceListings(listings, '')).toHaveLength(3);
    expect(filterAudienceListings(listings, '   ')).toHaveLength(3);
  });

  it('matches on title, case-insensitively', () => {
    expect(
      filterAudienceListings(listings, 'whitefield').map((l) => l.propertyId)
    ).toEqual(['p1']);
  });

  it('matches on property code', () => {
    expect(
      filterAudienceListings(listings, 'prop-10').map((l) => l.propertyId)
    ).toEqual(['p2']);
  });

  it('survives listings with no title or code', () => {
    expect(filterAudienceListings(listings, 'zzz')).toEqual([]);
  });
});
