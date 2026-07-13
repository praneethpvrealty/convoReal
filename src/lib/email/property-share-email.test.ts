import { describe, expect, it } from 'vitest';
import { buildPropertyShareEmailContent, type ShareEmailProperty } from './property-share-email';

const baseProperty = (overrides: Partial<ShareEmailProperty>): ShareEmailProperty => ({
  title: 'Test Land',
  type: 'Residential Land/ Plot',
  listing_type: 'Sale',
  price: 0,
  rent_per_month: null,
  maintenance: null,
  location: 'Bommenahalli, Bangalore',
  sublocality: 'Bommenahalli',
  city: 'Bangalore',
  google_map_link: null,
  nearby_highlights: [],
  land_area: undefined,
  land_area_unit: undefined,
  land_zone: undefined,
  land_use_zoning: null,
  ownership_status: null,
  deal_remarks: null,
  jv_structure: null,
  owner_share_percent: null,
  builder_share_percent: null,
  goodwill_amount: null,
  documents: [],
  property_code: undefined,
  images: [],
  ...overrides,
});

describe('buildPropertyShareEmailContent', () => {
  it('builds a JD opportunity subject and body matching the agent-authored format', () => {
    const property = baseProperty({
      listing_type: 'JV/JD',
      land_area: 32,
      land_area_unit: 'Acres',
      land_use_zoning: 'Residential zone land 26A 13 G, Red Zone - 5A 29 G.',
      ownership_status: 'Multiple owners, Aggregation in process.',
      google_map_link: 'https://maps.app.goo.gl/ZoCRFNyHvhL3aXhi9',
      deal_remarks: 'Legal and land aggregation is in process.',
    });

    const { subject, body } = buildPropertyShareEmailContent(property, {
      recipientNames: ['Nilanjan', 'Saurabh'],
      agentName: 'Praneeth',
      agentPhone: '9900277111',
    });

    expect(subject).toBe('JD Opportunity || 32 Acres || Bommenahalli, Bangalore');
    expect(body).toContain('Hi Nilanjan and Saurabh,');
    expect(body).toContain('Land extension - 32 Acres');
    expect(body).toContain('Land use - Residential zone land 26A 13 G, Red Zone - 5A 29 G.');
    expect(body).toContain('Ownership - Multiple owners, Aggregation in process.');
    expect(body).toContain('JD proposal - To be discussed.');
    expect(body).toContain('Location: https://maps.app.goo.gl/ZoCRFNyHvhL3aXhi9');
    expect(body).toContain('Remarks: Legal and land aggregation is in process.');
    expect(body).toContain('Regards,');
    expect(body).toContain('Praneeth');
    expect(body).toContain('9900277111');
  });

  it('states the owner:builder share when JV terms are filled in', () => {
    const property = baseProperty({
      listing_type: 'JV/JD',
      owner_share_percent: 40,
      builder_share_percent: 60,
      jv_structure: 'Revenue Share',
      goodwill_amount: 2000000,
    });

    const { body } = buildPropertyShareEmailContent(property);
    expect(body).toContain('JD proposal - 40:60 share (owner:builder), Revenue Share, Goodwill ₹20,00,000');
  });

  it('builds an outright sale opportunity with price as the proposal line', () => {
    const property = baseProperty({
      listing_type: 'Sale',
      price: 50000000,
      land_area: 8.23,
      land_area_unit: 'Acres',
      ownership_status: 'Single owner',
    });

    const { subject, body } = buildPropertyShareEmailContent(property);
    expect(subject).toBe('Outright Opportunity || 8.23 Acres || Bommenahalli, Bangalore');
    expect(body).toContain('Ownership - Single owner');
    expect(body).toContain('Proposal - ₹5,00,00,000');
  });

  it('uses rent_per_month as the proposal line for Rent and Built to Suit listings', () => {
    const rent = buildPropertyShareEmailContent(baseProperty({ listing_type: 'Rent', rent_per_month: 45000 }));
    expect(rent.body).toContain('Proposal - ₹45,000/month');

    const bts = buildPropertyShareEmailContent(
      baseProperty({ listing_type: 'Built to Suit', rent_per_month: 250000, maintenance: 15000 })
    );
    expect(bts.body).toContain('Proposal - ₹2,50,000/month + ₹15,000 maintenance');
  });

  it('omits land/ownership/remarks lines entirely when the data is absent', () => {
    const property = baseProperty({ listing_type: 'Sale', price: 12000000 });
    const { body } = buildPropertyShareEmailContent(property);
    expect(body).not.toContain('Land extension');
    expect(body).not.toContain('Land use');
    expect(body).not.toContain('Ownership');
    expect(body).not.toContain('Remarks');
  });

  it('falls back to a plain "Hi," greeting when no recipient names are given', () => {
    const { body } = buildPropertyShareEmailContent(baseProperty({}));
    expect(body.startsWith('Hi,')).toBe(true);
  });

  it('reminds the agent to attach documents when the listing has any', () => {
    const property = baseProperty({
      documents: [JSON.stringify({ url: 'https://example.com/sketch.pdf', title: 'Sketch' })],
    });
    const { body } = buildPropertyShareEmailContent(property);
    expect(body).toContain("Sketch: Attached (remember to attach the file");
  });

  it('falls back to the location string when no google_map_link is set', () => {
    const property = baseProperty({ google_map_link: null, sublocality: 'Hosur Road', city: 'Bangalore' });
    const { body } = buildPropertyShareEmailContent(property);
    expect(body).toContain('Location: Hosur Road, Bangalore');
  });

  describe('photo links', () => {
    it('lists each image URL as a numbered link under a Photos heading', () => {
      const property = baseProperty({
        images: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
      });
      const { body } = buildPropertyShareEmailContent(property);
      expect(body).toContain('Photos:');
      expect(body).toContain('1. https://example.com/1.jpg');
      expect(body).toContain('2. https://example.com/2.jpg');
    });

    it('caps inlined photo links and notes the remainder instead of dropping them silently', () => {
      const images = Array.from({ length: 8 }, (_, i) => `https://example.com/${i + 1}.jpg`);
      const property = baseProperty({ images });
      const { body } = buildPropertyShareEmailContent(property);
      expect(body).toContain('5. https://example.com/5.jpg');
      expect(body).not.toContain('6. https://example.com/6.jpg');
      expect(body).toContain('...and 3 more photo(s) in the listing.');
    });

    it('omits the Photos section entirely when the listing has no images', () => {
      const { body } = buildPropertyShareEmailContent(baseProperty({ images: [] }));
      expect(body).not.toContain('Photos:');
    });

    it('filters out empty/falsy image entries', () => {
      const property = baseProperty({ images: ['', 'https://example.com/1.jpg', ''] as string[] });
      const { body } = buildPropertyShareEmailContent(property);
      expect(body).toContain('1. https://example.com/1.jpg');
      expect(body).not.toContain('2.');
    });
  });
});
