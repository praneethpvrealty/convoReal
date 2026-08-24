import { describe, expect, it } from 'vitest';

import { rankJourneyPropertyCandidates } from './property-candidates';

describe('rankJourneyPropertyCandidates', () => {
  const properties = [
    {
      id: 'jp-1',
      title: 'JP Nagar 100 Feet Road Commercial Building',
      property_code: 'PROP-101',
      sublocality: 'JP Nagar',
      location: '100 Feet Road, JP Nagar',
      city: 'Bengaluru',
      type: 'Commercial Building',
      tags: ['EV suitable'],
    },
    {
      id: 'jp-2',
      title: 'JP Nagar Commercial Land',
      property_code: 'PROP-102',
      sublocality: 'JP Nagar',
      location: 'Outer Ring Road',
      city: 'Bengaluru',
      type: 'Commercial Land',
      tags: [],
    },
    {
      id: 'ind-1',
      title: 'Indiranagar Showroom',
      property_code: 'PROP-103',
      sublocality: 'Indiranagar',
      location: '100 Feet Road',
      city: 'Bengaluru',
      type: 'Commercial Showroom',
      tags: [],
    },
  ];

  it('offers the strongest JP Nagar 100 Feet Road properties first', () => {
    const ranked = rankJourneyPropertyCandidates(
      'JP Nagar commercial property on a 100 feet road for an EV charging station',
      properties
    );
    expect(ranked.map((candidate) => candidate.property.id)).toEqual([
      'jp-1',
      'jp-2',
      'ind-1',
    ]);
    expect(ranked[0].reason).toContain('location');
  });

  it('does not pad the list with unrelated inventory', () => {
    expect(
      rankJourneyPropertyCandidates('farm land near Devanahalli', properties)
    ).toEqual([]);
  });
});
