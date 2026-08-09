import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  buildPropertyAlertTemplatePayload,
  buildPropertyAlertParams,
  pickPropertyAlertTemplate,
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

  it('is Utility, because Marketing is what Meta frequency-caps', () => {
    const payload = buildPropertyAlertTemplatePayload('https://www.convoreal.com');
    // Marketing templates are dropped with error 131049 for any recipient
    // at their per-user cap. Flipping this back silently loses sends.
    expect(payload.category).toBe('Utility');
  });

  it('carries no opt-out footer, which would read as promotional', () => {
    const payload = buildPropertyAlertTemplatePayload('https://www.convoreal.com');
    expect(payload.footer_text ?? '').not.toMatch(/stop|unsubscribe/i);
  });

  it('is worded as a reply to a request, not as a broadcast', () => {
    const body = buildPropertyAlertTemplatePayload('https://www.convoreal.com').body_text;
    expect(body).toMatch(/enquiry/i);
    expect(body).not.toMatch(/just came up|new property match|don't miss/i);
  });

  it('carries no sales CTA anywhere — that is what got the predecessor re-categorised', () => {
    const payload = buildPropertyAlertTemplatePayload('https://www.convoreal.com');
    // Meta classifies mixed utility+marketing content as Marketing,
    // which error-131049 frequency caps silently drop. "Site visit",
    // "book", offers and emoji ad-card styling all read as promotional.
    const everything = [
      payload.body_text,
      ...(payload.buttons ?? []).map((b) => b.text),
      ...(payload.sample_values?.body ?? []),
    ].join('\n');
    expect(everything).not.toMatch(/site visit|book|offer|discount|exclusive|premium|don'?t miss/i);
    expect(payload.body_text).not.toMatch(/[*_]|🏠|📍/);
  });

  it('orders the quick reply before the dynamic URL button', () => {
    const payload = buildPropertyAlertTemplatePayload('https://www.convoreal.com/');
    const types = (payload.buttons ?? []).map((b) => b.type);
    expect(types).toEqual(['QUICK_REPLY', 'URL']);
    const urlBtn = payload.buttons?.find((b) => b.type === 'URL');
    expect(urlBtn && 'url' in urlBtn ? urlBtn.url : '').toBe('https://www.convoreal.com/{{1}}');
  });
});

describe('buildPropertyAlertParams', () => {
  it('builds first name, brokerage, title, specs and locality', () => {
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
      'Aryavarta Ventures',
    );
    expect(params).toEqual([
      'Gopi',
      'Aryavarta Ventures',
      'Premium Commercial Property for Sale in Hoodi, Bangalore',
      '₹32 Cr · 23,500 Sq.Ft.',
      'Hoodi, Bangalore',
    ]);
  });

  it('shows rent for rental listings and BHK when present', () => {
    const [, , , specs] = buildPropertyAlertParams(
      null,
      prop({ listing_type: 'Rent', rent_per_month: 85000, bedrooms: 3, area_sqft: 1650 }),
    );
    expect(specs).toBe('₹85,000/mo rent · 1,650 Sq.Ft. · 3 BHK');
  });

  it('greets a placeholder-named lead as "there", not by its portal', () => {
    // A lead whose name never parsed is filed as "Housing Lead"; greeting
    // on the first word made that "Hi Housing," to a real buyer.
    const [name] = buildPropertyAlertParams('Housing Lead', prop({ title: 'A plot' }));
    expect(name).toBe('there');
  });

  it('never returns empty params', () => {
    const params = buildPropertyAlertParams(undefined, prop({ title: ' ', price: 0, location: '' }));
    expect(params).toEqual([
      'there',
      'ConvoReal',
      'New listing',
      'Details on request',
      'Location shared on request',
    ]);
    for (const p of params) expect(p.length).toBeGreaterThan(0);
  });
});

describe('pickPropertyAlertTemplate', () => {
  const row = (name: string, status: string, category?: string) => ({
    name,
    status,
    category,
  });

  it('prefers the current name once it is approved as Utility', () => {
    expect(
      pickPropertyAlertTemplate([
        row('property_enquiry_response', 'APPROVED', 'Utility'),
        row(PROPERTY_ALERT_TEMPLATE_NAME, 'APPROVED', 'Utility'),
      ])?.name
    ).toBe(PROPERTY_ALERT_TEMPLATE_NAME);
  });

  it('falls back while the new name is still pending', () => {
    expect(
      pickPropertyAlertTemplate([
        row('property_enquiry_response', 'APPROVED', 'Utility'),
        row(PROPERTY_ALERT_TEMPLATE_NAME, 'PENDING', 'Utility'),
      ])?.name
    ).toBe('property_enquiry_response');
  });

  it('falls back when the new name is rejected', () => {
    expect(
      pickPropertyAlertTemplate([
        row('property_enquiry_response', 'APPROVED', 'Utility'),
        row(PROPERTY_ALERT_TEMPLATE_NAME, 'REJECTED', 'Utility'),
      ])?.name
    ).toBe('property_enquiry_response');
  });

  it('keeps the Utility legacy over a new name Meta made Marketing', () => {
    // The failure mode that matters: Meta approves a Utility submission
    // as MARKETING rather than rejecting it, and Marketing is dropped
    // at the per-user cap with 131049. Category has to outrank name.
    expect(
      pickPropertyAlertTemplate([
        row('property_enquiry_response', 'APPROVED', 'Utility'),
        row(PROPERTY_ALERT_TEMPLATE_NAME, 'APPROVED', 'Marketing'),
      ])?.name
    ).toBe('property_enquiry_response');
  });

  it('still sends on a Marketing row when that is all there is', () => {
    expect(
      pickPropertyAlertTemplate([row('new_property_alert', 'APPROVED', 'Marketing')])
        ?.name
    ).toBe('new_property_alert');
  });

  it('prefers the newest name among equals', () => {
    expect(
      pickPropertyAlertTemplate([
        row('new_property_alert', 'APPROVED', 'Utility'),
        row('property_enquiry_details', 'APPROVED', 'Utility'),
        row('property_enquiry_response', 'APPROVED', 'Utility'),
      ])?.name
    ).toBe('property_enquiry_response');
  });

  it('sorts an unrecognised name last rather than first', () => {
    // indexOf returns -1 for a stranger, which would otherwise make it
    // the most preferred row of all.
    expect(
      pickPropertyAlertTemplate([
        row('someone_elses_template', 'APPROVED', 'Utility'),
        row('property_enquiry_response', 'APPROVED', 'Utility'),
      ])?.name
    ).toBe('property_enquiry_response');
  });

  it('is null when nothing is approved', () => {
    expect(
      pickPropertyAlertTemplate([
        row(PROPERTY_ALERT_TEMPLATE_NAME, 'PENDING', 'Utility'),
        row('property_enquiry_response', 'REJECTED', 'Utility'),
      ])
    ).toBeNull();
    expect(pickPropertyAlertTemplate([])).toBeNull();
  });
});
