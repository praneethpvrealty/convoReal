import { describe, expect, it } from 'vitest';
import { getMatchingContacts } from './matching';
import { rankProperties } from './radar/engine';
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
  describe('Property type gate (subtype-level)', () => {
    it('matches when the contact prefers the exact subtype group', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_extracted_at: new Date().toISOString(),
      });
      const apartment = createTestProperty({ type: 'Flat/ Apartment' });
      const results = getMatchingContacts(apartment, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.type).toBe('match');
    });

    it('excludes an apartment seeker from an independent house even though both are residential', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_extracted_at: new Date().toISOString(),
      });
      const house = createTestProperty({ type: 'Residential House' });
      expect(getMatchingContacts(house, [contact]).length).toBe(0);
    });

    it('excludes a residential buyer from commercial and industrial properties', () => {
      const contact = createTestContact({
        pref_property_categories: ['residential'],
        pref_extracted_at: new Date().toISOString(),
      });
      const commercial = createTestProperty({ type: 'Commercial Office Space' });
      const industrial = createTestProperty({ type: 'Industrial Shed' });
      const apartment = createTestProperty({ type: 'Flat/ Apartment' });

      expect(getMatchingContacts(commercial, [contact]).length).toBe(0);
      expect(getMatchingContacts(industrial, [contact]).length).toBe(0);
      expect(getMatchingContacts(apartment, [contact]).length).toBe(1);
    });

    it('allows a category-level preference to match any subtype in that category', () => {
      const contact = createTestContact({
        pref_property_categories: ['commercial'],
        pref_extracted_at: new Date().toISOString(),
      });
      const office = createTestProperty({ type: 'Commercial Office Space' });
      const shop = createTestProperty({ type: 'Commercial Shop' });

      expect(getMatchingContacts(office, [contact]).length).toBe(1);
      expect(getMatchingContacts(shop, [contact]).length).toBe(1);
    });

    it('infers type preferences from free text when no extraction has run (e.g. "luxury apartment")', () => {
      const contact = createTestContact({
        property_interests: [],
        requirements: 'need a luxury apartment in South Bangalore',
      });

      const luxuryApt = createTestProperty({ type: 'Apartment', title: 'Luxury Penthouse' });
      const commercialOffice = createTestProperty({ type: 'Commercial Office', title: 'Office Space' });

      expect(getMatchingContacts(luxuryApt, [contact]).length).toBe(1);
      expect(getMatchingContacts(commercialOffice, [contact]).length).toBe(0);
    });

    it('respects negated category constraints in text (e.g. "no commercial")', () => {
      const contact = createTestContact({
        property_interests: ['Vacant plot'],
        requirements: 'looking for vacant plots, but no commercial please',
      });

      const commercialProp = createTestProperty({ type: 'Commercial Land', title: 'Commercial Plot' });
      const residentialProp = createTestProperty({ type: 'Residential Land', title: 'Residential Plot' });

      expect(getMatchingContacts(commercialProp, [contact]).length).toBe(0);
      expect(getMatchingContacts(residentialProp, [contact]).length).toBe(1);
    });
  });

  describe('Listing intent gate (Sale / Rent / JV/JD / Built to Suit)', () => {
    it('never surfaces a JV/JD property for a contact with no stated JV intent', () => {
      const contact = createTestContact({
        pref_property_categories: ['residential'],
        pref_extracted_at: new Date().toISOString(),
      });
      const jvLand = createTestProperty({
        type: 'Residential Land/ Plot',
        listing_type: 'JV/JD',
      });
      expect(getMatchingContacts(jvLand, [contact]).length).toBe(0);
    });

    it('never surfaces a Built to Suit property for a contact with no stated BTS intent', () => {
      const contact = createTestContact({
        pref_property_categories: ['commercial'],
        pref_extracted_at: new Date().toISOString(),
      });
      const btsShed = createTestProperty({
        type: 'Industrial Shed',
        listing_type: 'Built to Suit',
      });
      expect(getMatchingContacts(btsShed, [contact]).length).toBe(0);
    });

    it('matches a JV/JD property for a contact with explicit JV/JD intent', () => {
      const contact = createTestContact({
        pref_property_categories: ['residential'],
        pref_listing_types: ['JV/JD'],
        pref_extracted_at: new Date().toISOString(),
      });
      const jvLand = createTestProperty({
        type: 'Residential Land/ Plot',
        listing_type: 'JV/JD',
      });
      const results = getMatchingContacts(jvLand, [contact]);
      expect(results.length).toBe(1);
    });

    it('infers JV intent from free text ("joint development") when no extraction has run', () => {
      const contact = createTestContact({
        requirements: 'landowner looking for joint development partners',
      });
      const jvLand = createTestProperty({
        type: 'Residential Land/ Plot',
        listing_type: 'JV/JD',
      });
      expect(getMatchingContacts(jvLand, [contact]).length).toBe(1);
    });

    it('excludes a Sale property for a contact whose stated intent is Rent only', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_listing_types: ['Rent'],
        pref_extracted_at: new Date().toISOString(),
      });
      const saleFlat = createTestProperty({ type: 'Flat/ Apartment', listing_type: 'Sale' });
      expect(getMatchingContacts(saleFlat, [contact]).length).toBe(0);
    });

    it('does not gate Sale/Rent when the contact has no stated listing intent (backward compatible)', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_extracted_at: new Date().toISOString(),
      });
      const saleFlat = createTestProperty({ type: 'Flat/ Apartment', listing_type: 'Sale' });
      const rentFlat = createTestProperty({ type: 'Flat/ Apartment', listing_type: 'Rent' });
      expect(getMatchingContacts(saleFlat, [contact]).length).toBe(1);
      expect(getMatchingContacts(rentFlat, [contact]).length).toBe(1);
    });

    it('matches Rent budget against rent_per_month rather than price', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_listing_types: ['Rent'],
        pref_budget_max: 50000,
        pref_extracted_at: new Date().toISOString(),
      });
      const rentFlat = createTestProperty({
        type: 'Flat/ Apartment',
        listing_type: 'Rent',
        price: 10000000, // mirrors rent_per_month by convention, ignored here
        rent_per_month: 45000,
      });
      const results = getMatchingContacts(rentFlat, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.budget).toBe('match');
    });
  });

  describe('Location refinement', () => {
    it('matches an area of interest against an internal property tag', () => {
      const contact = createTestContact({
        pref_property_types: ['Commercial Building'],
        areas_of_interest: ['Lotus'],
        pref_extracted_at: new Date().toISOString(),
        strict_area_match: true,
      });
      const property = createTestProperty({
        type: 'Commercial Building',
        location: 'Koramangala, Bangalore',
        sublocality: 'Koramangala',
        tags: ['LOTUS'],
      });

      const results = getMatchingContacts(property, [contact]);
      expect(results).toHaveLength(1);
      expect(results[0].details.location).toBe('match');
    });

    it('matches a property tag mentioned in requirements text', () => {
      const contact = createTestContact({
        pref_property_types: ['Commercial Building'],
        requirements: 'Looking for the Lotus opportunity',
      });
      const property = createTestProperty({
        type: 'Commercial Building',
        location: 'Koramangala, Bangalore',
        tags: ['LOTUS'],
      });

      const results = getMatchingContacts(property, [contact]);
      expect(results).toHaveLength(1);
      expect(results[0].details.location).toBe('match');
    });

    it('excludes contacts whose stated areas do not cover the property', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        areas_of_interest: ['Indiranagar'],
        pref_extracted_at: new Date().toISOString(),
        strict_area_match: true,
      });
      const property = createTestProperty({
        type: 'Flat/ Apartment',
        location: 'Whitefield, Bangalore',
        sublocality: 'Whitefield',
      });
      expect(getMatchingContacts(property, [contact]).length).toBe(0);
    });

    it('ranks a location match above a contact with no stated areas', () => {
      const withArea = createTestContact({
        id: 'c-area',
        pref_property_types: ['Flat/ Apartment'],
        areas_of_interest: ['HSR Layout'],
        pref_extracted_at: new Date().toISOString(),
      });
      const noArea = createTestContact({
        id: 'c-noarea',
        pref_property_types: ['Flat/ Apartment'],
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({ type: 'Flat/ Apartment', sublocality: 'HSR Layout' });

      const results = getMatchingContacts(property, [withArea, noArea]);
      expect(results.length).toBe(2);
      expect(results[0].contact.id).toBe('c-area');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('respects negated location constraints in text (e.g. "not Jayanagar")', () => {
      const contact = createTestContact({
        areas_of_interest: ['Jayanagar', 'HSR Layout'],
        requirements: 'Interested in Jayanagar or HSR, but not Jayanagar due to high price',
      });

      const jayanagarProp = createTestProperty({ sublocality: 'Jayanagar' });
      const hsrProp = createTestProperty({ sublocality: 'HSR Layout' });

      expect(getMatchingContacts(jayanagarProp, [contact]).length).toBe(0);
      expect(getMatchingContacts(hsrProp, [contact]).length).toBe(1);
    });

    it('does not carry a generic no-preference answer into the next locality line', () => {
      const contact = createTestContact({
        pref_property_types: ['Residential Land/ Plot'],
        pref_areas: ['HSR Layout'],
        pref_extracted_at: new Date().toISOString(),
        no_budget: true,
        requirements:
          'Looking for investing about 25 cr by November 2026.\nNo such preference\nHSR Layout',
        strict_area_match: true,
      });
      const hsrPlot = createTestProperty({
        type: 'Residential Plot',
        title: 'Residential Plot in Sector 6 HSR Layout',
        sublocality: 'HSR Layout',
        location: 'Sector 6 HSR Layout, Bangalore',
        latitude: 12.9157736,
        longitude: 77.6280642,
        price: 135_000_000,
      });

      const [match] = getMatchingContacts(hsrPlot, [contact]);

      expect(match?.details.type).toBe('match');
      expect(match?.details.location).toBe('match');
      expect(match?.score).toBeGreaterThanOrEqual(60);
    });

    it('respects AI-extracted excluded areas', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_areas: ['HSR Layout'],
        pref_excluded_areas: ['Whitefield'],
        pref_extracted_at: new Date().toISOString(),
      });
      const excluded = createTestProperty({ type: 'Flat/ Apartment', sublocality: 'Whitefield', location: 'Whitefield' });
      expect(getMatchingContacts(excluded, [contact]).length).toBe(0);
    });

    it('matches when notes explicitly mention the project name (e.g. "SJR Blue Waters")', () => {
      const contact = createTestContact({
        areas_of_interest: ['Whitefield'],
        requirements: 'looking for properties specifically in SJR Blue Waters',
      });

      const matchedProp = createTestProperty({
        project: 'SJR Blue Waters',
        sublocality: 'JP Nagar',
      });

      const results = getMatchingContacts(matchedProp, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.location).toBe('match');
    });

    it('treats an "any …" entry among the stated areas as no location constraint', () => {
      const contact = createTestContact({
        property_interests: ['Vacant plot'],
        areas_of_interest: ['JP Nagar', 'Indiranagar', 'any commercial location'],
      });
      const faraway = createTestProperty({
        type: 'Commercial Land',
        location: 'Bychapura, Karnataka',
        sublocality: 'Bychapura',
        city: 'Bychapura',
        latitude: 13.2334113,
        longitude: 77.7072594,
      });

      const results = getMatchingContacts(faraway, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.location).toBe('unknown');
    });

    it('still ranks a real area hit beside a placeholder as a location match', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        areas_of_interest: ['HSR Layout', 'Anywhere'],
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({ type: 'Flat/ Apartment', sublocality: 'HSR Layout' });

      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.location).toBe('match');
    });

    it('does not read a locality that merely starts like a placeholder as one', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        areas_of_interest: ['Anekal'],
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({
        type: 'Flat/ Apartment',
        location: 'Whitefield, Bangalore',
        sublocality: 'Whitefield',
      });
      expect(getMatchingContacts(property, [contact]).length).toBe(0);
    });
  });

  describe('Budget applied last', () => {
    it('never matches a contact on budget alone', () => {
      const contact = createTestContact({
        min_budget: 5000000,
        max_budget: 15000000,
      });
      const property = createTestProperty({ price: 10000000 });
      expect(getMatchingContacts(property, [contact]).length).toBe(0);
    });

    it('excludes a type match whose stated budget is far below the price', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        max_budget: 8000000, // 80L
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({ type: 'Flat/ Apartment', price: 15000000 }); // 1.5 Cr
      expect(getMatchingContacts(property, [contact]).length).toBe(0);
    });

    it('keeps near-miss budgets (within 10%) with a lower score', () => {
      const within = createTestContact({
        id: 'c-within',
        pref_property_types: ['Flat/ Apartment'],
        max_budget: 10000000,
        pref_extracted_at: new Date().toISOString(),
      });
      const nearMiss = createTestContact({
        id: 'c-near',
        pref_property_types: ['Flat/ Apartment'],
        max_budget: 9500000, // price is ~5% over
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({ type: 'Flat/ Apartment', price: 10000000 });

      const results = getMatchingContacts(property, [within, nearMiss]);
      expect(results.length).toBe(2);
      expect(results[0].contact.id).toBe('c-within');
      expect(results.find((r) => r.contact.id === 'c-near')?.details.budget).toBe('partial');
    });

    it('excludes a type match whose stated max budget is far above the price', () => {
      const contact = createTestContact({
        pref_property_types: ['Residential House'],
        max_budget: 200000000, // 20 Cr
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({ type: 'Residential House', price: 43200000 }); // 4.32 Cr
      expect(getMatchingContacts(property, [contact]).length).toBe(0);
    });

    it('grades a price just under half the stated max as partial', () => {
      const contact = createTestContact({
        pref_property_types: ['Residential House'],
        max_budget: 200000000, // 20 Cr → implied floor 10 Cr, partial down to 8 Cr
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({ type: 'Residential House', price: 85000000 }); // 8.5 Cr
      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.budget).toBe('partial');
    });

    it('lets an explicit min budget widen the band below the implied floor', () => {
      const contact = createTestContact({
        pref_property_types: ['Residential House'],
        min_budget: 20000000, // 2 Cr
        max_budget: 200000000, // 20 Cr
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({ type: 'Residential House', price: 43200000 }); // 4.32 Cr
      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.budget).toBe('match');
    });

    it('extracts budget limits from notes text when no structured budget exists', () => {
      const contact = createTestContact({
        requirements: 'looking for office spaces under 1.5 Cr',
      });

      const cheapProp = createTestProperty({ type: 'Commercial Office', price: 12000000 }); // 1.2 Cr
      const expensiveProp = createTestProperty({ type: 'Commercial Office', price: 18000000 }); // 1.8 Cr

      expect(getMatchingContacts(cheapProp, [contact]).length).toBe(1);
      expect(getMatchingContacts(expensiveProp, [contact]).length).toBe(0);
    });

    it('keeps ceiling-only semantics for "under X" phrasing in text', () => {
      const contact = createTestContact({
        requirements: 'looking for office spaces under 1.5 Cr',
      });
      const farBelow = createTestProperty({ type: 'Commercial Office', price: 5000000 }); // 50L, under half of 1.5 Cr
      const results = getMatchingContacts(farBelow, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.budget).toBe('match');
    });

    it('implies no floor for an entry-band max ("Under ₹50 Lakh")', () => {
      const contact = createTestContact({
        pref_property_types: ['Residential Land/ Plot'],
        pref_budget_max: 5000000, // the bottom sale band
        pref_extracted_at: new Date().toISOString(),
      });
      const plot = createTestProperty({ type: 'Residential Land/ Plot', price: 1500000 }); // 15L
      const results = getMatchingContacts(plot, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.budget).toBe('match');
    });

    it('does not let a sale-scale max exclude rentals for a contact with no rent intent', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        max_budget: 20000000, // 2 Cr purchase budget
        pref_extracted_at: new Date().toISOString(),
      });
      const rental = createTestProperty({
        type: 'Flat/ Apartment',
        listing_type: 'Rent',
        rent_per_month: 60000,
      });
      const results = getMatchingContacts(rental, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.budget).toBe('match');
    });

    it('keeps the implied floor for a rent-intent contact with a rent-scale max', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_listing_types: ['Rent'],
        pref_budget_max: 100000, // ₹1L/month
        pref_extracted_at: new Date().toISOString(),
      });
      const cheapRental = createTestProperty({
        type: 'Flat/ Apartment',
        listing_type: 'Rent',
        rent_per_month: 25000,
      });
      expect(getMatchingContacts(cheapRental, [contact]).length).toBe(0);
    });
  });

  describe('BHK fit', () => {
    it('scores a BHK match above a BHK mismatch', () => {
      const wants3 = createTestContact({
        id: 'c-3bhk',
        pref_property_types: ['Flat/ Apartment'],
        pref_bhk_min: 3,
        pref_bhk_max: 3,
        pref_extracted_at: new Date().toISOString(),
      });
      const wants1 = createTestContact({
        id: 'c-1bhk',
        pref_property_types: ['Flat/ Apartment'],
        pref_bhk_min: 1,
        pref_bhk_max: 1,
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({ type: 'Flat/ Apartment', bedrooms: 3 });

      const results = getMatchingContacts(property, [wants1, wants3]);
      expect(results[0].contact.id).toBe('c-3bhk');
      expect(results[0].details.bhk).toBe('match');
      expect(results.find((r) => r.contact.id === 'c-1bhk')?.details.bhk).toBe('mismatch');
    });
  });

  describe('ROI yield matching', () => {
    it('matches an ROI-only investor when property yield meets the expectation', () => {
      const contact = createTestContact({ min_roi: 4 });
      const property = createTestProperty({ roi: 5 });
      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(1);
    });

    it('excludes when property ROI is below min_roi', () => {
      const contact = createTestContact({ min_roi: 5 });
      const property = createTestProperty({ roi: 4 });
      expect(getMatchingContacts(property, [contact]).length).toBe(0);
    });

    it('does not match a contact whose only signal is the no_budget flag', () => {
      const contact = createTestContact({ min_roi: null, no_budget: true });
      const property = createTestProperty({ roi: 4 });
      expect(getMatchingContacts(property, [contact]).length).toBe(0);
    });

    it('parses yield requirements from notes when no structured ROI exists', () => {
      const contact = createTestContact({
        min_roi: null,
        contact_notes: [{ note_text: 'looking for yield > 5% on commercial spaces' }],
      });
      const lowYieldProp = createTestProperty({ roi: 4 });
      const highYieldProp = createTestProperty({ roi: 6 });

      expect(getMatchingContacts(lowYieldProp, [contact]).length).toBe(0);
      expect(getMatchingContacts(highYieldProp, [contact]).length).toBe(1);
    });

    it('bypasses location for yield-matching commercial properties', () => {
      const contact = createTestContact({
        min_roi: 4.5,
        areas_of_interest: ['Indiranagar'],
      });
      const property = createTestProperty({
        location: 'Whitefield, Bangalore',
        sublocality: 'Whitefield',
        type: 'Commercial Office',
        roi: 5.0,
      });

      expect(getMatchingContacts(property, [contact]).length).toBe(1);
    });

    it('does NOT bypass location for residential properties matching yield', () => {
      const contact = createTestContact({
        min_roi: 4.5,
        areas_of_interest: ['Indiranagar'],
        strict_area_match: true,
      });
      const property = createTestProperty({
        location: 'Whitefield, Bangalore',
        sublocality: 'Whitefield',
        type: 'Residential Apartment',
        roi: 5.0,
      });

      expect(getMatchingContacts(property, [contact]).length).toBe(0);
    });
  });

  describe('Ranking', () => {
    it('ranks type+location+budget above type+budget above type-only', () => {
      const full = createTestContact({
        id: 'c-full',
        pref_property_types: ['Flat/ Apartment'],
        pref_areas: ['HSR Layout'],
        max_budget: 12000000,
        pref_extracted_at: new Date().toISOString(),
      });
      const typeBudget = createTestContact({
        id: 'c-type-budget',
        pref_property_types: ['Flat/ Apartment'],
        max_budget: 12000000,
        pref_extracted_at: new Date().toISOString(),
      });
      const typeOnly = createTestContact({
        id: 'c-type',
        pref_property_types: ['Flat/ Apartment'],
        pref_extracted_at: new Date().toISOString(),
      });
      const property = createTestProperty({
        type: 'Flat/ Apartment',
        sublocality: 'HSR Layout',
        price: 10000000,
      });

      const results = getMatchingContacts(property, [typeOnly, typeBudget, full]);
      expect(results.map((r) => r.contact.id)).toEqual(['c-full', 'c-type-budget', 'c-type']);
    });
  });

  describe('Strict Area, Land ROI Bypass, and Min Budget 20% Gap logic', () => {
    it('bypasses ROI expectation mismatch for raw land properties', () => {
      const contact = createTestContact({
        min_roi: 8.0,
        property_interests: ['Vacant plot'],
      });
      const landProperty = createTestProperty({
        type: 'Commercial Land',
        price: 400000000,
        roi: null,
      });

      const results = getMatchingContacts(landProperty, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.roi).toBe('unknown');
    });

    it('matches within 20 kms if strict_area_match is false, but mismatches if strict_area_match is true and distance is > 5 kms', () => {
      // Kasturi Nagar to Indiranagar is ~3.6 kms
      const contactNonStrict = createTestContact({
        id: 'c-non-strict',
        areas_of_interest: ['Indiranagar'],
        strict_area_match: false,
      });
      const contactStrict = createTestContact({
        id: 'c-strict',
        areas_of_interest: ['Indiranagar'],
        strict_area_match: true,
      });
      
      const kasturiNagarProp = createTestProperty({
        sublocality: 'Kasturi Nagar',
        type: 'Flat/ Apartment',
      });

      const results = getMatchingContacts(kasturiNagarProp, [contactNonStrict, contactStrict]);
      // Both match since 3.6 km is <= 5 km and <= 20 km
      expect(results.map(r => r.contact.id)).toContain('c-non-strict');
      expect(results.map(r => r.contact.id)).toContain('c-strict');

      // Whitefield to Indiranagar is ~11.8 kms
      const whitefieldProp = createTestProperty({
        sublocality: 'Whitefield',
        type: 'Flat/ Apartment',
      });

      const resultsWhitefield = getMatchingContacts(whitefieldProp, [contactNonStrict, contactStrict]);
      // Only non-strict matches since 11.8 km is <= 20 km but > 5 km
      expect(resultsWhitefield.map(r => r.contact.id)).toContain('c-non-strict');
      expect(resultsWhitefield.map(r => r.contact.id)).not.toContain('c-strict');
    });

    it('radius-matches areas outside the static locality table via stored Google coordinates', () => {
      // "Surya City Phase 2" is not in BANGALORE_LOCALITIES_COORDS — without
      // stored coordinates it can only substring-match. With coordinates it
      // must participate in proximity matching.
      const contactNear = createTestContact({
        id: 'c-geo-near',
        areas_of_interest: ['Surya City Phase 2'],
        areas_of_interest_geo: [{ name: 'Surya City Phase 2', lat: 12.98, lng: 77.76 }],
        strict_area_match: true,
      });
      const contactFar = createTestContact({
        id: 'c-geo-far',
        areas_of_interest: ['Surya City Phase 2'],
        areas_of_interest_geo: [{ name: 'Surya City Phase 2', lat: 13.5, lng: 78.3 }], // ~85 km away
        strict_area_match: false,
      });

      const property = createTestProperty({
        sublocality: 'Some Unknown Layout',
        latitude: 12.97,
        longitude: 77.75,
        type: 'Flat/ Apartment',
      });

      const results = getMatchingContacts(property, [contactNear, contactFar]);
      // ~1.6 km away → matches even with strict (5 km) radius
      expect(results.map(r => r.contact.id)).toContain('c-geo-near');
      // ~85 km away → outside even the relaxed 20 km radius
      expect(results.map(r => r.contact.id)).not.toContain('c-geo-far');
    });

    it('prefers contact-stored coordinates over the static locality table', () => {
      // Static table places Indiranagar ~3.6 km from Kasturi Nagar (a match),
      // but the contact's stored coordinates for "Indiranagar" point far away
      // — the stored coordinates must win.
      const contact = createTestContact({
        id: 'c-geo-override',
        areas_of_interest: ['Indiranagar'],
        areas_of_interest_geo: [{ name: 'Indiranagar', lat: 13.5, lng: 78.3 }],
        strict_area_match: false,
      });

      const kasturiNagarProp = createTestProperty({
        sublocality: 'Kasturi Nagar',
        type: 'Flat/ Apartment',
      });

      const results = getMatchingContacts(kasturiNagarProp, [contact]);
      expect(results.map(r => r.contact.id)).not.toContain('c-geo-override');
    });

    it('allows a 20% budget gap tolerance on the minimum budget side', () => {
      const contact = createTestContact({
        min_budget: 500000000, // 50 Cr
        max_budget: 800000000, // 80 Cr
        property_interests: ['Vacant plot'],
      });
      const property = createTestProperty({
        type: 'Commercial Land',
        price: 400000000, // 40 Cr (exactly 80% of min_budget)
      });

      const results = getMatchingContacts(property, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.budget).toBe('partial');
    });
  });

  describe('Named-project signal (pref_projects)', () => {
    it('finds a named project stored only as an internal property tag', () => {
      const contact = createTestContact({
        pref_projects: ['Lotus'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({
        title: 'Commercial opportunity',
        project: undefined,
        tags: ['LOTUS'],
      });

      const results = getMatchingContacts(prop, [contact]);
      expect(results).toHaveLength(1);
      expect(results[0].details.project).toBe('match');
      expect(results[0].score).toBeGreaterThanOrEqual(60);
    });

    it('matches a property in a named project via the project field', () => {
      const contact = createTestContact({
        pref_projects: ['Purva Vantage'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({ project: 'Purva Vantage', type: 'Flat/ Apartment' });
      const results = getMatchingContacts(prop, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.project).toBe('match');
      expect(results[0].matchedFields.project).toBe(true);
      expect(results[0].score).toBeGreaterThanOrEqual(60);
    });

    it('matches when the project name appears in the property title', () => {
      const contact = createTestContact({
        pref_projects: ['DSR Rainbow Heights'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({ title: '2 BHK in DSR Rainbow Heights, HSR', project: undefined });
      const results = getMatchingContacts(prop, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.project).toBe('match');
    });

    it('does not match a contact who did not name the project', () => {
      const contact = createTestContact({
        pref_projects: ['Purva Vantage'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({
        project: 'Prestige Lakeside',
        type: 'Flat/ Apartment',
        location: 'Whitefield',
      });
      expect(getMatchingContacts(prop, [contact]).length).toBe(0);
    });

    it('surfaces a named project even when the property type conflicts', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_projects: ['Meenakshi Classic'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({ type: 'Residential Plot', project: 'Meenakshi Classic Sector 1' });
      const results = getMatchingContacts(prop, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.project).toBe('match');
    });

    it('lets a named project win over an excluded-area overlap', () => {
      const contact = createTestContact({
        pref_projects: ['Purva Vantage'],
        pref_excluded_areas: ['HSR Layout'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({
        project: 'Purva Vantage',
        location: 'HSR Layout, Bangalore',
        type: 'Flat/ Apartment',
      });
      const results = getMatchingContacts(prop, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.project).toBe('match');
    });

    it('ranks a project match above a plain locality match', () => {
      const projectContact = createTestContact({
        id: 'c-proj',
        pref_projects: ['Purva Vantage'],
        pref_extracted_at: new Date().toISOString(),
      });
      const areaContact = createTestContact({
        id: 'c-area',
        pref_areas: ['HSR Layout'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({
        project: 'Purva Vantage',
        location: 'HSR Layout, Bangalore',
        type: 'Flat/ Apartment',
      });
      const results = getMatchingContacts(prop, [projectContact, areaContact]);
      expect(results[0].contact.id).toBe('c-proj');
    });

    it('reads the agent-entered watchlist as well as the AI-extracted one', () => {
      const contact = createTestContact({ projects_of_interest: ['Purva Westend'] });
      const prop = createTestProperty({ project: 'Purva Westend', type: 'Flat/ Apartment' });
      const results = getMatchingContacts(prop, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.project).toBe('match');
    });

    it('matches a builder shorthand against the registered project name', () => {
      const contact = createTestContact({ projects_of_interest: ['Purva Westend'] });
      const prop = createTestProperty({
        project: 'Puravankara Westend',
        type: 'Flat/ Apartment',
      });
      expect(getMatchingContacts(prop, [contact])[0].details.project).toBe('match');
    });
  });

  describe('Dead and archived contacts (migration 230)', () => {
    it('excludes a lead who closed their enquiry from a perfect match', () => {
      const contact = createTestContact({
        is_dead: true,
        property_interests: ['Flat/ Apartment'],
        areas_of_interest: ['HSR Layout'],
        max_budget: 20000000,
      });
      const prop = createTestProperty({
        type: 'Flat/ Apartment',
        location: 'HSR Layout, Bangalore',
        price: 15000000,
      });
      expect(getMatchingContacts(prop, [contact]).length).toBe(0);
    });

    it('excludes an archived contact', () => {
      const contact = createTestContact({
        is_archived: true,
        property_interests: ['Flat/ Apartment'],
      });
      const prop = createTestProperty({ type: 'Flat/ Apartment' });
      expect(getMatchingContacts(prop, [contact]).length).toBe(0);
    });

    it('outranks a named-project hit, which nothing else survives', () => {
      const contact = createTestContact({
        is_dead: true,
        projects_of_interest: ['Purva Westend'],
      });
      const prop = createTestProperty({
        project: 'Purva Westend',
        type: 'Flat/ Apartment',
      });
      expect(getMatchingContacts(prop, [contact]).length).toBe(0);
    });

    it('drops only the dead contact from a mixed list', () => {
      const dead = createTestContact({
        id: 'c-dead',
        is_dead: true,
        property_interests: ['Flat/ Apartment'],
      });
      const live = createTestContact({
        id: 'c-live',
        property_interests: ['Flat/ Apartment'],
      });
      const prop = createTestProperty({ type: 'Flat/ Apartment' });
      const results = getMatchingContacts(prop, [dead, live]);
      expect(results.map((r) => r.contact.id)).toEqual(['c-live']);
    });

    it('treats absent flags as live, so rows predating the columns still match', () => {
      const contact = createTestContact({ property_interests: ['Flat/ Apartment'] });
      const prop = createTestProperty({ type: 'Flat/ Apartment' });
      expect(getMatchingContacts(prop, [contact]).length).toBe(1);
    });
  });

  describe('Parked requirements (requirement_active)', () => {
    it('excludes a parked contact from an otherwise perfect match', () => {
      const contact = createTestContact({
        requirement_active: false,
        property_interests: ['Flat/ Apartment'],
        areas_of_interest: ['HSR Layout'],
        max_budget: 20000000,
      });
      const prop = createTestProperty({
        type: 'Flat/ Apartment',
        location: 'HSR Layout, Bangalore',
        price: 15000000,
      });
      expect(getMatchingContacts(prop, [contact]).length).toBe(0);
    });

    it('outranks even a named-project hit, which nothing else survives', () => {
      const contact = createTestContact({
        requirement_active: false,
        projects_of_interest: ['Purva Westend'],
      });
      const prop = createTestProperty({ project: 'Purva Westend', type: 'Flat/ Apartment' });
      expect(getMatchingContacts(prop, [contact]).length).toBe(0);
    });

    it('keeps matching once the requirement is live again', () => {
      const contact = createTestContact({
        requirement_active: true,
        property_interests: ['Flat/ Apartment'],
      });
      const prop = createTestProperty({ type: 'Flat/ Apartment' });
      expect(getMatchingContacts(prop, [contact]).length).toBe(1);
    });

    it('treats an absent flag as live, so rows predating the column still match', () => {
      const contact = createTestContact({ property_interests: ['Flat/ Apartment'] });
      const prop = createTestProperty({ type: 'Flat/ Apartment' });
      expect(getMatchingContacts(prop, [contact]).length).toBe(1);
    });

    it('drops only the parked contact from a mixed list', () => {
      const parked = createTestContact({
        id: 'c-parked',
        requirement_active: false,
        property_interests: ['Flat/ Apartment'],
      });
      const live = createTestContact({
        id: 'c-live',
        property_interests: ['Flat/ Apartment'],
      });
      const prop = createTestProperty({ type: 'Flat/ Apartment' });
      const results = getMatchingContacts(prop, [parked, live]);
      expect(results.map((r) => r.contact.id)).toEqual(['c-live']);
    });
  });

  describe('Residential property interests', () => {
    it('matches a flat buyer to an apartment', () => {
      const contact = createTestContact({ property_interests: ['Flat/ Apartment'] });
      const prop = createTestProperty({ type: 'Flat/ Apartment' });
      const results = getMatchingContacts(prop, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.type).toBe('match');
    });

    it('keeps a flat buyer away from plots', () => {
      const contact = createTestContact({ property_interests: ['Flat/ Apartment'] });
      const prop = createTestProperty({ type: 'Residential Land/ Plot' });
      expect(getMatchingContacts(prop, [contact]).length).toBe(0);
    });

    it('matches a villa buyer to a villa', () => {
      const contact = createTestContact({ property_interests: ['Villa'] });
      const prop = createTestProperty({ type: 'Villa' });
      expect(getMatchingContacts(prop, [contact])[0].details.type).toBe('match');
    });

    it('matches a commercial office seeker to office stock', () => {
      const contact = createTestContact({ property_interests: ['Commercial Office Space'] });
      const prop = createTestProperty({ type: 'Commercial Office Space' });
      expect(getMatchingContacts(prop, [contact])[0].details.type).toBe('match');
    });

    // The lead answered "Land", then "Commercial or Semi commercial",
    // and was shown two residential plots under a line that read
    // "Perfect — commercial land, up to ₹8 Cr". 'plot' means land
    // rather than a building; it does not mean any sector will do, and
    // on its own it had been opening the gate to every plot in stock.
    it('keeps a commercial land buyer away from residential and farm plots', () => {
      const contact = createTestContact({
        pref_property_types: ['Commercial Land'],
        pref_property_categories: ['commercial', 'plot'],
        pref_extracted_at: new Date().toISOString(),
      });
      for (const type of ['Residential Land/ Plot', 'Agricultural Land']) {
        expect(getMatchingContacts(createTestProperty({ type }), [contact]).length, type).toBe(0);
      }
    });

    it('still matches the commercial land that buyer asked for', () => {
      const contact = createTestContact({
        pref_property_types: ['Commercial Land'],
        pref_property_categories: ['commercial', 'plot'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({ type: 'Commercial Land' });
      expect(getMatchingContacts(prop, [contact])[0].details.type).toBe('match');
    });

    it('mirrors it: a residential plot buyer is not shown commercial land', () => {
      const contact = createTestContact({
        pref_property_categories: ['residential', 'plot'],
        pref_extracted_at: new Date().toISOString(),
      });
      const commercial = createTestProperty({ type: 'Commercial Land' });
      expect(getMatchingContacts(commercial, [contact]).length).toBe(0);
      const residential = createTestProperty({ type: 'Residential Land/ Plot' });
      expect(getMatchingContacts(residential, [contact])[0].details.type).toBe('partial');
    });

    it('leaves a buyer who only said "land" open to every plot', () => {
      const contact = createTestContact({
        pref_property_categories: ['plot'],
        pref_extracted_at: new Date().toISOString(),
      });
      for (const type of ['Residential Land/ Plot', 'Commercial Land', 'Agricultural Land']) {
        const prop = createTestProperty({ type });
        expect(getMatchingContacts(prop, [contact])[0].details.type, type).toBe('partial');
      }
    });
  });

  describe('Strict project watchlist (strict_project_match)', () => {
    it('excludes a listing outside the watchlist that otherwise fits', () => {
      const contact = createTestContact({
        projects_of_interest: ['Purva Westend'],
        strict_project_match: true,
        pref_property_types: ['Flat/ Apartment'],
        pref_areas: ['HSR Layout'],
        max_budget: 20000000,
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({
        title: '2 BHK in SJR Blue Waters',
        project: 'SJR Blue Waters',
        type: 'Flat/ Apartment',
        location: 'HSR Layout, Bangalore',
        price: 15000000,
      });
      expect(getMatchingContacts(prop, [contact]).length).toBe(0);
    });

    it('still matches the watchlisted project', () => {
      const contact = createTestContact({
        projects_of_interest: ['Purva Westend'],
        strict_project_match: true,
        pref_property_types: ['Flat/ Apartment'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({
        project: 'Purva Westend',
        type: 'Flat/ Apartment',
        location: 'Kudlu, Bangalore',
      });
      const results = getMatchingContacts(prop, [contact]);
      expect(results.length).toBe(1);
      expect(results[0].details.project).toBe('match');
    });

    it('is inert when the watchlist is empty, so the flag alone excludes nobody', () => {
      const contact = createTestContact({
        strict_project_match: true,
        pref_property_types: ['Flat/ Apartment'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({ type: 'Flat/ Apartment', project: 'SJR Blue Waters' });
      expect(getMatchingContacts(prop, [contact]).length).toBe(1);
    });

    it('does not gate contacts who left the flag off', () => {
      const contact = createTestContact({
        projects_of_interest: ['Purva Westend'],
        pref_property_types: ['Flat/ Apartment'],
        pref_extracted_at: new Date().toISOString(),
      });
      const prop = createTestProperty({ type: 'Flat/ Apartment', project: 'SJR Blue Waters' });
      expect(getMatchingContacts(prop, [contact]).length).toBe(1);
    });
  });

  describe('Plot/built-up size band', () => {
    // "Looking for lesser dimensions" against a 4,200 sq.ft. plot: the
    // anchored cap (3,780) must actually exclude that plot, not grade
    // it a near-miss.
    const seeker = (over: Partial<Contact>) =>
      createTestContact({
        pref_property_types: ['Commercial Land'],
        pref_extracted_at: new Date().toISOString(),
        ...over,
      });
    const plot = (land_area: number, unit = 'sqft') =>
      createTestProperty({
        type: 'Commercial Land',
        land_area,
        land_area_unit: unit,
      });

    it('excludes a plot beyond the stated cap', () => {
      const contact = seeker({ pref_land_area_max_sqft: 3780 });
      expect(getMatchingContacts(plot(4200), [contact]).length).toBe(0);
    });

    it('matches inside the band and grades a near-miss partial', () => {
      const contact = seeker({ pref_land_area_max_sqft: 3780 });
      expect(
        getMatchingContacts(plot(2400), [contact])[0]?.details.size
      ).toBe('match');
      expect(
        getMatchingContacts(plot(4000), [contact])[0]?.details.size
      ).toBe('partial');
    });

    it('converts the property unit before comparing', () => {
      const contact = seeker({ pref_land_area_min_sqft: 40000 });
      // 1 acre = 43,560 sqft — inside the band despite the small figure.
      expect(
        getMatchingContacts(plot(1, 'acre'), [contact])[0]?.details.size
      ).toBe('match');
    });

    it('enforces a floor the same way', () => {
      const contact = seeker({ pref_land_area_min_sqft: 4000 });
      expect(getMatchingContacts(plot(1200), [contact]).length).toBe(0);
      expect(
        getMatchingContacts(plot(4200), [contact])[0]?.details.size
      ).toBe('match');
    });

    it('falls back to built-up area when there is no land figure', () => {
      const contact = createTestContact({
        pref_property_types: ['Flat/ Apartment'],
        pref_land_area_max_sqft: 1500,
        pref_extracted_at: new Date().toISOString(),
      });
      const flat = createTestProperty({
        type: 'Flat/ Apartment',
        area_sqft: 2400,
      });
      expect(getMatchingContacts(flat, [contact]).length).toBe(0);
    });

    it('stays unknown for a property with no size on file', () => {
      const contact = seeker({ pref_land_area_max_sqft: 3780 });
      const sizeless = createTestProperty({ type: 'Commercial Land' });
      expect(
        getMatchingContacts(sizeless, [contact])[0]?.details.size
      ).toBe('unknown');
    });
  });
});

// Stage 2 of parties: a couple sharing one requirement produced two
// match sets, two Radar events and two lines in the buyer digest.
// Passing a party index makes the answer one row per deal.
describe('party collapse', () => {
  const parties = new Map([
    [
      'ravi',
      {
        id: 'party-1',
        name: null,
        kind: 'household' as const,
        primaryContactId: 'ravi',
        memberIds: ['ravi', 'pruthvi'],
      },
    ],
    [
      'pruthvi',
      {
        id: 'party-1',
        name: null,
        kind: 'household' as const,
        primaryContactId: 'ravi',
        memberIds: ['ravi', 'pruthvi'],
      },
    ],
  ]);

  const office = createTestProperty({
    type: 'Commercial Office',
    price: 10000000,
  });
  const buyer = (id: string, over: Partial<Contact> = {}) =>
    createTestContact({
      id,
      name: id,
      pref_property_types: ['Commercial Office'],
      pref_extracted_at: new Date().toISOString(),
      ...over,
    });

  it('returns one row per deal instead of one per person', () => {
    const results = getMatchingContacts(
      office,
      [buyer('ravi'), buyer('pruthvi')],
      parties
    );
    expect(results).toHaveLength(1);
    expect(results[0].party?.id).toBe('party-1');
    expect(results[0].alsoMatched?.map((c) => c.id)).toEqual(['pruthvi']);
  });

  // The brief often lives on only one of the two records, so the best
  // score is the party's true score — taking the primary's would
  // understate a deal whose preferences sit on the spouse.
  it('keeps the highest-scoring member as the row', () => {
    const results = getMatchingContacts(
      office,
      [
        buyer('ravi', { pref_property_types: [], pref_extracted_at: null }),
        buyer('pruthvi', { max_budget: 12000000, min_budget: 8000000 }),
      ],
      parties
    );
    expect(results).toHaveLength(1);
    expect(results[0].contact.id).toBe('pruthvi');
  });

  it('is per person again when no party index is passed', () => {
    expect(
      getMatchingContacts(office, [buyer('ravi'), buyer('pruthvi')])
    ).toHaveLength(2);
  });

  it('leaves a buyer who buys alone unannotated', () => {
    const results = getMatchingContacts(office, [buyer('solo')], parties);
    expect(results).toHaveLength(1);
    expect(results[0].party).toBeUndefined();
  });
});


describe('portal enquiry matching regression', () => {
  it('returns the exact live listing first before a generic brief exists', () => {
    const enquired = createTestProperty({
      id: 'prop-1072',
      title: 'Bilekahalli Plot',
      type: 'Residential Land/ Plot',
    });
    const unrelated = createTestProperty({
      id: 'prop-other',
      title: 'Unrelated Plot',
      type: 'Residential Land/ Plot',
    });
    const contact = createTestContact({
      last_inquired_property_id: enquired.id,
    });

    const matches = rankProperties(contact, [unrelated, enquired]);

    expect(matches.map((match) => match.property.id)).toEqual(['prop-1072']);
    expect(matches[0].score).toBe(100);
  });

  it('matches Bilekahalli for Vijaya Bank Layout and compares a per-sqft ceiling correctly', () => {
    const contact = createTestContact({
      pref_property_categories: ['plot'],
      pref_budget_max: 25_000,
      pref_areas: ['Vijaya Bank Layout'],
      pref_extracted_at: new Date().toISOString(),
      requirements: 'Residential plot, 2,400 sq.ft near Vijaya Bank Layout. 25k psqft max',
      strict_area_match: true,
    });
    const property = createTestProperty({
      id: 'prop-1072',
      title: 'Bilekahalli Residential Plot',
      type: 'Residential Land/ Plot',
      location: 'Bilekahalli, Bannerghatta Road',
      price: 48_000_000,
      price_per_sqft: 20_000,
      land_area: 2_400,
      land_area_unit: 'sqft',
    });

    const [match] = getMatchingContacts(property, [contact]);

    expect(match?.details.location).toBe('match');
    expect(match?.details.budget).toBe('match');
  });

  it('accepts the common Vijay Bank spelling variant', () => {
    const contact = createTestContact({
      pref_property_categories: ['plot'],
      pref_areas: ['Vijay Bank Layout'],
      pref_extracted_at: new Date().toISOString(),
      strict_area_match: true,
    });
    const property = createTestProperty({
      type: 'Residential Land/ Plot',
      location: 'Bilekahalli',
    });

    expect(getMatchingContacts(property, [contact])).toHaveLength(1);
  });
});
