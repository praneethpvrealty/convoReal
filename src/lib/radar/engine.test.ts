import { describe, expect, it } from 'vitest';
import { memorySupabase } from '@/test/memory-supabase';
import {
  isRadarContactClassification,
  rankProperties,
  rankPropertiesForContact,
} from './engine';
import type { Contact, Property } from '@/types';

describe('isRadarContactClassification', () => {
  it.each(['Buyer', 'Owner & Buyer', 'Agent'])(
    'keeps %s eligible for Match Radar',
    (classification) => {
      expect(isRadarContactClassification(classification)).toBe(true);
    }
  );

  it.each(['Owner', 'Seller', 'Developer', 'Others', null])(
    'does not treat %s as a buyer requirement',
    (classification) => {
      expect(isRadarContactClassification(classification)).toBe(false);
    }
  );
});

describe('rankProperties enquiry budget gating', () => {
  const enquiredProperty: Property = {
    id: 'prop-1095',
    account_id: 'acc-1',
    title: 'Old residential house in 4200 sqft plot in Koramangala 1st block',
    price: 147_000_000,
    location: 'Koramangala 1st block',
    sublocality: 'Koramangala 1st block',
    city: 'Bangalore',
    type: 'Independent House/ Villa',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
  } as unknown as Property;

  it('ranks enquired property at score 100 before contact has stated a budget', () => {
    const contact: Contact = {
      id: 'c-1',
      account_id: 'acc-1',
      name: 'Santhosh',
      last_inquired_property_id: 'prop-1095',
      classification: 'Buyer',
    } as unknown as Contact;

    const matches = rankProperties(contact, [enquiredProperty]);
    expect(matches.length).toBe(1);
    expect(matches[0].property.id).toBe('prop-1095');
    expect(matches[0].score).toBe(100);
  });

  it('excludes enquired property when contact states a budget that is a mismatch', () => {
    const contact: Contact = {
      id: 'c-1',
      account_id: 'acc-1',
      name: 'Santhosh',
      last_inquired_property_id: 'prop-1095',
      classification: 'Buyer',
      pref_budget_max: 20_000_000, // ₹2 Cr vs ₹14.7 Cr
      pref_property_types: ['Independent House/ Villa'],
      pref_areas: ['Koramangala'],
    } as unknown as Contact;

    const matches = rankProperties(contact, [enquiredProperty]);
    expect(matches.length).toBe(0);
  });

  it('ranks enquired property at score 100 when contact stated budget matches the price', () => {
    const contact: Contact = {
      id: 'c-1',
      account_id: 'acc-1',
      name: 'Santhosh',
      last_inquired_property_id: 'prop-1095',
      classification: 'Buyer',
      pref_budget_max: 150_000_000, // ₹15 Cr fits ₹14.7 Cr
      pref_property_types: ['Independent House/ Villa'],
      pref_areas: ['Koramangala 1st block'],
    } as unknown as Contact;

    const matches = rankProperties(contact, [enquiredProperty]);
    expect(matches.length).toBe(1);
    expect(matches[0].property.id).toBe('prop-1095');
    expect(matches[0].score).toBe(100);
  });
});

describe('[CNV-002] rankPropertiesForContact strictArea', () => {
  const jpNagarPlot = {
    id: 'p-2nd',
    account_id: 'acc-1',
    title: 'Prime Commercial Site for Sale',
    type: 'Commercial Plot',
    listing_type: 'Sale',
    status: 'Available',
    is_published: true,
    sublocality: 'JP Nagar 2nd Phase',
    location: 'JP Nagar 2nd Phase, Bangalore',
    city: 'Bangalore',
    price: 96000000,
    latitude: 12.9119,
    longitude: 77.5951,
  };
  // Whitefield is about 18 km from JP Nagar: inside the ordinary 20 km
  // radius, outside the 5 km strict one.
  const contact = {
    id: 'c-1',
    account_id: 'acc-1',
    name: 'Shirish',
    classification: 'Buyer',
    property_interests: ['Commercial'],
    pref_areas: ['Whitefield'],
    strict_area_match: true,
    pref_listing_types: ['Sale'],
    pref_extracted_at: new Date().toISOString(),
  };
  const db = () =>
    ({
      ...memorySupabase({
        contacts: [{ ...contact }],
        properties: [{ ...jpNagarPlot }],
        listing_feedback: [],
        property_shares: [],
      }),
      rpc: async () => ({ data: [], error: null }),
    }) as never;

  it('honours a saved strict flag by default and when asked for strict', async () => {
    expect(await rankPropertiesForContact(db(), 'acc-1', 'c-1')).toHaveLength(
      0
    );
    expect(
      await rankPropertiesForContact(db(), 'acc-1', 'c-1', { strictArea: true })
    ).toHaveLength(0);
  });

  it('overrides a saved strict flag when the caller asks for the ordinary radius', async () => {
    const matches = await rankPropertiesForContact(db(), 'acc-1', 'c-1', {
      strictArea: false,
    });
    expect(matches.map((m) => m.property.id)).toEqual(['p-2nd']);
  });
});
