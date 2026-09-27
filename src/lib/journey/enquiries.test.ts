import { describe, expect, it } from 'vitest';

import { journeyEnquiryEntries } from './enquiries';

describe('journeyEnquiryEntries', () => {
  const enquiryRows = [
    {
      id: 'old',
      inquiry_source: 'Housing',
      inquiry_date: '2026-01-02T00:00:00Z',
      created_at: '2026-03-01T00:00:00Z',
      property: {
        id: 'p1',
        title: 'Villa 12',
        property_code: 'PROP-12',
        location: 'Whitefield',
      },
      contact: { id: 'c1', name: 'Supreeth', phone: '+917022217893' },
    },
    {
      id: 'new',
      inquiry_source: null,
      inquiry_date: null,
      created_at: '2026-02-01T00:00:00Z',
      property: null,
      contact: null,
    },
  ];

  it('[JRN-012] lists the enquired properties newest first and links each one', () => {
    expect(journeyEnquiryEntries(enquiryRows, 'buyer')).toEqual([
      {
        id: 'new',
        targetId: null,
        title: 'Unknown property',
        subtitle: '',
        source: null,
        enquiredAt: '2026-02-01T00:00:00Z',
      },
      {
        id: 'old',
        targetId: 'p1',
        title: 'Villa 12',
        subtitle: 'PROP-12 · Whitefield',
        source: 'Housing',
        enquiredAt: '2026-01-02T00:00:00Z',
      },
    ]);
  });

  it('[JRN-012] lists the enquiring buyers on a property journey', () => {
    expect(journeyEnquiryEntries(enquiryRows, 'property')[1]).toMatchObject({
      targetId: 'c1',
      title: 'Supreeth',
      subtitle: '+917022217893',
    });
  });
});
