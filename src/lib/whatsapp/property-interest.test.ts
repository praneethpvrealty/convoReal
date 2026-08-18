import { describe, expect, it } from 'vitest';
import type { PropertyInterestCandidate } from './property-interest';
import {
  buildCatalogOrderMessage,
  buildPropertyInterestAck,
  buildPropertyInterestQuestion,
  isDirectPropertyInterest,
  mentionedAreaSqft,
  resolvePropertyReference,
} from './property-interest';

function property(
  overrides: Partial<PropertyInterestCandidate> = {}
): PropertyInterestCandidate {
  return {
    id: 'akshay-acre',
    title: '1 Acre Commercial Land in Akshaya Nagar',
    property_code: 'PROP-1090',
    status: 'Available',
    is_published: true,
    land_area: 1,
    land_area_unit: 'Acre',
    area_sqft: undefined,
    area_unit: undefined,
    sublocality: 'Akshaya Nagar',
    locality_canonical: null,
    location: 'Akshaya Nagar, Bengaluru',
    project: undefined,
    tags: [],
    ...overrides,
  };
}

describe('specific property interest detection', () => {
  it("recognises Sid's reference without turning his broad requirement into one", () => {
    expect(
      isDirectPropertyInterest(
        '1acre in Akshaynagar i saw I was interested in that'
      )
    ).toBe(true);
    expect(
      isDirectPropertyInterest(
        'Looking for industrial / commercial lands around the peripherals with high growth potential'
      )
    ).toBe(false);
  });

  it('normalises the acreage into square feet', () => {
    expect(mentionedAreaSqft('1acre in Akshaynagar')).toBe(43_560);
  });
});

describe('resolvePropertyReference', () => {
  it('matches the Akshaya Nagar acre listing instead of the JP Nagar plot', () => {
    const result = resolvePropertyReference(
      '1acre in Akshaynagar i saw I was interested in that',
      [
        property(),
        property({
          id: 'jp-plot',
          title: '2400 Sqft Commercial Plot in JP Nagar 4th Phase',
          property_code: 'PROP-1004',
          land_area: 2400,
          land_area_unit: 'Sq.Ft.',
          sublocality: 'JP Nagar 4th Phase',
          location: 'JP Nagar 4th Phase, Bengaluru',
        }),
      ]
    );

    expect(result).toMatchObject({
      kind: 'match',
      matchedBy: 'natural',
      property: { id: 'akshay-acre' },
    });
  });

  it('does not guess when two live listings fit the same reference', () => {
    const result = resolvePropertyReference(
      'I saw the 1 acre in Akshaynagar and was interested in that',
      [
        property(),
        property({ id: 'akshay-acre-2', property_code: 'PROP-1091' }),
      ]
    );

    expect(result.kind).toBe('ambiguous');
  });

  it('does not accept the right locality with the wrong acreage', () => {
    expect(
      resolvePropertyReference(
        'I saw the 1 acre in Akshaynagar and was interested in that',
        [property({ land_area: 20, land_area_unit: 'Gunta' })]
      )
    ).toEqual({ kind: 'unresolved' });
  });

  it('keeps property-code references authoritative', () => {
    expect(
      resolvePropertyReference('Please share PROP-1090 details', [property()])
    ).toMatchObject({ kind: 'match', matchedBy: 'code' });
  });

  it('also resolves a catalog retailer UUID to the property', () => {
    expect(
      resolvePropertyReference('Property selected\n• akshay-acre', [property()])
    ).toMatchObject({
      kind: 'match',
      matchedBy: 'code',
      property: { id: 'akshay-acre' },
    });
  });
});

describe('WhatsApp catalog orders', () => {
  it('renders a readable selection instead of an unsupported-type label', () => {
    const message = buildCatalogOrderMessage({
      text: 'Please share the details',
      product_items: [
        {
          product_retailer_id: 'PROP-1090',
          quantity: '1',
          item_price: '70000000',
          currency: 'INR',
        },
      ],
    });

    expect(message).toContain('Property selected from the WhatsApp catalog');
    expect(message).toContain('PROP-1090');
    expect(message).toContain('INR 7,00,00,000');
    expect(message).toContain('Please share the details');
    expect(message).not.toContain('Unsupported message type');
  });
});

describe('property interest replies', () => {
  it('acknowledges the exact property and invites questions for the agent', () => {
    expect(
      buildPropertyInterestAck('Sid', '1 Acre Commercial Land in Akshaya Nagar')
    ).toContain('1 Acre Commercial Land in Akshaya Nagar');
    expect(buildPropertyInterestQuestion()).toMatch(/specific questions/i);
    expect(buildPropertyInterestQuestion()).toMatch(/right agent/i);
  });
});
