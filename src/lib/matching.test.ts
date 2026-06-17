import { describe, expect, it } from 'vitest';
import { getMatchingContacts } from './matching';
import type { Contact, Property } from '@/types';

// Helper to construct a base contact
const createTestContact = (overrides: Partial<Contact>): Contact => {
  return {
    id: 'c-1',
    user_id: 'u-1',
    phone: '+919876543210',
    name: 'Test Contact',
    classification: 'Buyer',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
};

// Helper to construct a base property
const createTestProperty = (overrides: Partial<Property>): Property => {
  return {
    id: 'p-1',
    account_id: 'a-1',
    user_id: 'u-1',
    title: 'Test Property',
    price: 10000000, // 1 Crore
    location: 'HSR Layout, Bangalore',
    type: 'Commercial Office',
    status: 'Available',
    is_published: true,
    features: [],
    images: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
};

describe('getMatchingContacts', () => {
  describe('ROI Yield Matching', () => {
    it('matches property when ROI exceeds min_roi preference', () => {
      const contact = createTestContact({ min_roi: 4 });
      const property = createTestProperty({ roi: 5 });
      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].contact.id).toBe(contact.id);
    });

    it('excludes property when ROI is less than min_roi preference', () => {
      const contact = createTestContact({ min_roi: 5 });
      const property = createTestProperty({ roi: 4 });
      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(0);
    });

    it('matches when contact has no min_roi set', () => {
      const contact = createTestContact({ min_roi: null });
      const property = createTestProperty({ roi: 4 });
      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(1);
    });

    it('parses yield requirements from notes text dynamically when min_roi field is null', () => {
      const contact = createTestContact({
        min_roi: null,
        contact_notes: [{ note_text: 'looking for yield > 5% on commercial spaces' } as any],
      });
      const lowYieldProp = createTestProperty({ roi: 4 });
      const highYieldProp = createTestProperty({ roi: 6 });

      expect(getMatchingContacts(lowYieldProp, [contact]).length).toBe(0);
      expect(getMatchingContacts(highYieldProp, [contact]).length).toBe(1);
    });
  });

  describe('Location-Agnostic Yield Matching', () => {
    it('bypasses location requirements for commercial properties matching yield preferences', () => {
      const contact = createTestContact({
        min_roi: 4.5,
        areas_of_interest: ['Indiranagar'], // Specific area
      });
      // Property is Commercial and yields 5.0%, but is in Whitefield (not Indiranagar)
      const property = createTestProperty({
        location: 'Whitefield, Bangalore',
        sublocality: 'Whitefield',
        type: 'Commercial Office',
        roi: 5.0,
      });

      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(1); // Matches location-agnostically!
    });

    it('does NOT bypass location requirements for residential properties matching yield preferences', () => {
      const contact = createTestContact({
        min_roi: 4.5,
        areas_of_interest: ['Indiranagar'],
      });
      // Property is Residential (Apartment) and yields 5.0%, but is in Whitefield
      const property = createTestProperty({
        location: 'Whitefield, Bangalore',
        sublocality: 'Whitefield',
        type: 'Residential Apartment',
        roi: 5.0,
      });

      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(0); // Fails location check!
    });
  });

  describe('Notes/Requirements Negation constraints', () => {
    it('respects negated location constraints (e.g. "not Jayanagar")', () => {
      const contact = createTestContact({
        areas_of_interest: ['Jayanagar', 'HSR Layout'],
        requirements: 'Interested in Jayanagar or HSR, but not Jayanagar due to high price',
      });
      
      const jayanagarProp = createTestProperty({ sublocality: 'Jayanagar' });
      const hsrProp = createTestProperty({ sublocality: 'HSR Layout' });

      // Jayanagar matches area array but is explicitly negated in text
      expect(getMatchingContacts(jayanagarProp, [contact]).length).toBe(0);
      expect(getMatchingContacts(hsrProp, [contact]).length).toBe(1);
    });

    it('respects negated category constraints (e.g. "no commercial")', () => {
      const contact = createTestContact({
        property_interests: ['Vacant plot'],
        requirements: 'looking for vacant plots, but no commercial please',
      });

      const commercialProp = createTestProperty({ type: 'Commercial Land', title: 'Commercial Plot' });
      const residentialProp = createTestProperty({ type: 'Residential Land', title: 'Residential Plot' });

      expect(getMatchingContacts(commercialProp, [contact]).length).toBe(0); // Fails due to "no commercial" negation
      expect(getMatchingContacts(residentialProp, [contact]).length).toBe(1);
    });
  });

  describe('Notes/Requirements Keyword and Landmark matching', () => {
    it('infers category match from notes keywords (e.g. "luxury apartment")', () => {
      const contact = createTestContact({
        property_interests: [], // empty selection
        requirements: 'need a luxury apartment in South Bangalore',
      });

      const luxuryApt = createTestProperty({ type: 'Apartment', title: 'Luxury Penthouse' });
      const commercialOffice = createTestProperty({ type: 'Commercial Office', title: 'Office Space' });

      expect(getMatchingContacts(luxuryApt, [contact]).length).toBe(1);
      expect(getMatchingContacts(commercialOffice, [contact]).length).toBe(0);
    });

    it('matches property if notes explicitly mention project name (e.g. "SJR Blue Waters")', () => {
      const contact = createTestContact({
        areas_of_interest: ['Whitefield'], // areas list does not contain JP Nagar
        requirements: 'looking for properties specifically in SJR Blue Waters',
      });

      const matchedProp = createTestProperty({
        project: 'SJR Blue Waters',
        sublocality: 'JP Nagar',
      });

      expect(getMatchingContacts(matchedProp, [contact]).length).toBe(1);
    });
  });

  describe('Text Budget Heuristics Parsing', () => {
    it('extracts budget limits from notes text if budget fields are empty', () => {
      const contact = createTestContact({
        min_budget: undefined,
        max_budget: undefined,
        requirements: 'looking for spaces under 1.5 Cr',
      });

      const cheapProp = createTestProperty({ price: 12000000 }); // 1.2 Cr
      const expensiveProp = createTestProperty({ price: 18000000 }); // 1.8 Cr

      expect(getMatchingContacts(cheapProp, [contact]).length).toBe(1);
      expect(getMatchingContacts(expensiveProp, [contact]).length).toBe(0);
    });
  });
});
