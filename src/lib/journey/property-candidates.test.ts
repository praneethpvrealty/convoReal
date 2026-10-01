import { describe, expect, it } from 'vitest';

import {
  ownedPropertyCandidates,
  rankJourneyPropertyCandidates,
} from './property-candidates';

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

  it('[JRN-016] never offers a property because it shares a filler word with the message', () => {
    const fillerTitles = [
      {
        id: 'p-1154',
        title: '3 BHK Independent Building Floor House for Sale in Emerald Enclave, Mysuru',
        property_code: 'PROP-1154',
        location: 'the Emerald Enclave',
      },
      {
        id: 'p-1108',
        title: 'Residential House in Koramangala 7th phase, opposite to the park is for sale.',
        property_code: 'PROP-1108',
      },
      {
        id: 'p-1878',
        title: '300 Acres Residential Land with the plan approval on Harohalli to Bidadi Road',
        property_code: 'PROP-1878',
      },
    ];
    expect(
      rankJourneyPropertyCandidates(
        'Yogendranath to share the family tree application number by today evening.',
        fillerTitles
      )
    ).toEqual([]);
  });
});

describe('ownedPropertyCandidates', () => {
  const owned = [
    {
      id: 'own-1',
      title: '#19, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
      property_code: 'PROP-1403',
      sublocality: 'JP Nagar 4th Phase',
    },
    {
      id: 'own-2',
      title: 'Villa in Whitefield',
      property_code: 'PROP-1500',
      sublocality: 'Whitefield',
    },
  ];

  it('[JRN-016] offers every property the contact owns, the one the message points at first', () => {
    const ranked = ownedPropertyCandidates(
      'Family tree for the Whitefield villa is pending',
      owned,
      'Yogendranath'
    );
    expect(ranked.map((candidate) => candidate.property.id)).toEqual([
      'own-2',
      'own-1',
    ]);
    expect(ranked[0].reason).toMatch(/^owned by Yogendranath · /);
    expect(ranked[1].reason).toBe('owned by Yogendranath');
  });
});
