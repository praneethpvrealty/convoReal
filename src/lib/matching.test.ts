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

    it('extracts budget limits from notes text when no structured budget exists', () => {
      const contact = createTestContact({
        requirements: 'looking for office spaces under 1.5 Cr',
      });

      const cheapProp = createTestProperty({ type: 'Commercial Office', price: 12000000 }); // 1.2 Cr
      const expensiveProp = createTestProperty({ type: 'Commercial Office', price: 18000000 }); // 1.8 Cr

      expect(getMatchingContacts(cheapProp, [contact]).length).toBe(1);
      expect(getMatchingContacts(expensiveProp, [contact]).length).toBe(0);
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
  });
});
