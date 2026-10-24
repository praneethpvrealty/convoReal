import { describe, expect, it } from 'vitest';
import type { PropertyInterestCandidate } from './property-interest';
import {
  buildCatalogOrderMessage,
  buildPropertyInterestAck,
  buildPropertyInterestQuestion,
  isDeliberateEnquiry,
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

  it('[INB-038] tells two plots in one block apart by the sides the buyer names', () => {
    const block = (overrides: Partial<PropertyInterestCandidate>) =>
      property({
        sublocality: 'Jayanagar 7th Block',
        location: 'Jayanagar 7th Block, Bangalore',
        land_area_unit: 'Sq.Ft.',
        ...overrides,
      });
    const result = resolvePropertyReference(
      'Also please send me the details of the plot at Jayanagar 7th block 50x70',
      [
        block({
          id: 'jaya-50x70',
          property_code: 'PROP-1765',
          title: '50x70 Commercial Plot for Sale in Jayanagar 7th Block',
          land_area: 3500,
        }),
        block({
          id: 'jaya-2400',
          property_code: 'PROP-1766',
          title: 'Commercial Plot in Jayanagar 7th Block',
          land_area: 2400,
        }),
      ]
    );
    expect(result).toMatchObject({
      kind: 'match',
      matchedBy: 'natural',
      property: { id: 'jaya-50x70' },
    });
    expect(
      resolvePropertyReference('I saw the 30x40 plot in Jayanagar 7th block', [
        block({
          id: 'jaya-no-area',
          property_code: 'PROP-1767',
          title: 'Plot in Jayanagar 7th Block',
          land_area: undefined,
          area_sqft: undefined,
        }),
      ])
    ).toMatchObject({ kind: 'match', property: { id: 'jaya-no-area' } });
    expect(
      resolvePropertyReference(
        'I saw the 30x40 house in Jayanagar 7th block, interested',
        [
          block({
            id: 'jaya-built-up',
            property_code: 'PROP-1768',
            title: 'House in Jayanagar 7th Block',
            land_area: undefined,
            area_sqft: 2400,
            area_unit: 'Sq.Ft.',
          }),
        ]
      )
    ).toMatchObject({ kind: 'match', property: { id: 'jaya-built-up' } });
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

  it('uses the persisted lead property for an anaphoric portal reply', () => {
    expect(
      resolvePropertyReference(
        'Interested in seeing the property and talking to the owner',
        [property()],
        'akshay-acre'
      )
    ).toMatchObject({
      kind: 'match',
      matchedBy: 'context',
      property: { id: 'akshay-acre' },
    });
  });

  it('does not use stale context for a newly named unmatched property', () => {
    expect(
      resolvePropertyReference(
        'Interested in the Whitefield property',
        [property()],
        'akshay-acre'
      )
    ).toEqual({ kind: 'unresolved' });
  });

  it('does not resolve contextual properties that are no longer available', () => {
    expect(
      resolvePropertyReference(
        'Interested in seeing the property',
        [property({ status: 'Sold' })],
        'akshay-acre'
      )
    ).toEqual({ kind: 'unresolved' });
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

  it('responds to visit and owner requests without the generic question', () => {
    const reply = buildPropertyInterestAck(
      'Dr K Bhagavan',
      'Prime Corner Commercial Plot',
      { visitRequested: true, ownerContactRequested: true }
    );

    expect(reply).toContain('Certainly Dr Bhagavan');
    expect(reply).toContain('site visit');
    expect(reply).toContain('conversation with the owner');
    expect(reply).toContain('preferred date and time');
  });
});

describe('isDeliberateEnquiry', () => {
  const discussed = (value: boolean) => async () => value;

  it('[PRP-014] treats a bare title question about an unavailable listing as an enquiry', async () => {
    const plot = property({
      title: 'Corner Residential Plot',
      status: 'Under Contract',
    });
    const resolution = resolvePropertyReference(
      'Is Corner Residential Plot still available?',
      [plot]
    );
    expect(resolution).toMatchObject({ kind: 'match', matchedBy: 'title' });
    expect(await isDeliberateEnquiry('title', plot, discussed(false))).toBe(
      true
    );
  });

  it('[PRP-014] does not repeat itself once the conversation has already named that listing', async () => {
    const plot = property({ status: 'Sold' });
    expect(await isDeliberateEnquiry('title', plot, discussed(true))).toBe(
      false
    );
  });

  it('[PRP-014] leaves a title match on an available listing to the existing flow without a lookup', async () => {
    let looked = false;
    expect(
      await isDeliberateEnquiry('title', property(), async () => {
        looked = true;
        return false;
      })
    ).toBe(false);
    expect(looked).toBe(false);
  });

  it('keeps a property code deliberate whatever the status or history', async () => {
    const plot = property();
    expect(await isDeliberateEnquiry('code', plot, discussed(true))).toBe(true);
    expect(await isDeliberateEnquiry('natural', plot, discussed(false))).toBe(
      false
    );
    expect(await isDeliberateEnquiry('context', plot, discussed(false))).toBe(
      false
    );
  });
});
