import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  buildPropertyAlertTemplatePayload,
  buildPropertyAlertParams,
  PROPERTY_ALERT_TEMPLATE_NAME,
} from './property-alert-template';
import { validateTemplatePayload } from './template-validators';

function prop(overrides: Partial<Property>): Property {
  return {
    id: 'p1',
    account_id: 'a1',
    user_id: 'u1',
    title: 'Untitled',
    price: 0,
    location: 'Bangalore',
    type: 'Residential Land/ Plot',
    status: 'Available',
    is_published: true,
    features: [],
    images: [],
    ...overrides,
  } as Property;
}

describe('buildPropertyAlertTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildPropertyAlertTemplatePayload('https://www.convoreal.com');
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(PROPERTY_ALERT_TEMPLATE_NAME);
  });

  it('orders quick replies before the dynamic URL button', () => {
    const payload = buildPropertyAlertTemplatePayload('https://www.convoreal.com/');
    const types = (payload.buttons ?? []).map((b) => b.type);
    expect(types).toEqual(['QUICK_REPLY', 'QUICK_REPLY', 'URL']);
    const urlBtn = payload.buttons?.find((b) => b.type === 'URL');
    expect(urlBtn && 'url' in urlBtn ? urlBtn.url : '').toBe('https://www.convoreal.com/{{1}}');
  });
});

describe('buildPropertyAlertParams', () => {
  it('builds first name, title, specs and locality', () => {
    const params = buildPropertyAlertParams(
      'Gopi Krishnan',
      prop({
        title: 'Premium Commercial Property for Sale in Hoodi, Bangalore',
        type: 'Commercial Office Space',
        price: 320000000,
        area_sqft: 23500,
        sublocality: 'Hoodi',
        city: 'Bangalore',
      }),
    );
    expect(params).toEqual([
      'Gopi',
      'Premium Commercial Property for Sale in Hoodi, Bangalore',
      '₹32 Cr · 23,500 Sq.Ft.',
      'Hoodi, Bangalore',
    ]);
  });

  it('shows rent for rental listings and BHK when present', () => {
    const [, , specs] = buildPropertyAlertParams(
      null,
      prop({ listing_type: 'Rent', rent_per_month: 85000, bedrooms: 3, area_sqft: 1650 }),
    );
    expect(specs).toBe('₹85,000/mo rent · 1,650 Sq.Ft. · 3 BHK');
  });

  it('never returns empty params', () => {
    const params = buildPropertyAlertParams(undefined, prop({ title: ' ', price: 0, location: '' }));
    expect(params).toEqual(['there', 'New listing', 'Details on request', 'Location shared on request']);
    for (const p of params) expect(p.length).toBeGreaterThan(0);
  });
});
