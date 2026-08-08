import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  buildEnquiryNoticeTemplatePayload,
  buildEnquiryNoticeParams,
  describeEnquiredProperty,
  ENQUIRY_NOTICE_TEMPLATE_NAME,
  ENQUIRY_NOTICE_UPDATE_BUTTON,
  ENQUIRY_NOTICE_CLOSE_BUTTON,
} from './enquiry-notice-template';
import { buildEnquiryFollowupTemplatePayload } from './enquiry-followup-template';
import { validateTemplatePayload } from './template-validators';
import { isPreferenceFlowRequestText } from './preference-flow';

function prop(overrides: Partial<Property>): Property {
  return {
    id: Math.random().toString(36).slice(2),
    account_id: 'a1',
    user_id: 'u1',
    title: 'Untitled',
    price: 0,
    location: 'Bangalore',
    type: 'Flat/ Apartment',
    status: 'Available',
    is_published: true,
    features: [],
    images: [],
    ...overrides,
  } as Property;
}

describe('buildEnquiryNoticeTemplatePayload', () => {
  it('produces a payload the submit API accepts, as Utility', () => {
    const payload = buildEnquiryNoticeTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(ENQUIRY_NOTICE_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
  });

  it('differs from the approved status template by the property line alone', () => {
    // This is the whole strategy. property_enquiry_status was approved
    // as Utility; property_enquiry_update was the same shape plus a
    // "Send listings" button and came back Marketing. So this template
    // changes exactly one thing from the known-good baseline, and this
    // test fails the moment anyone widens that delta.
    const approved = buildEnquiryFollowupTemplatePayload();
    const notice = buildEnquiryNoticeTemplatePayload();

    // Both templates carry {{2}} as the brokerage, so the only delta
    // left is the property line — which is {{3}} here and absent there.
    const withoutPropertyLine = notice.body_text.replace(
      'Property: {{3}}\n\n',
      ''
    );
    expect(withoutPropertyLine).toBe(approved.body_text);

    expect(notice.category).toBe(approved.category);
    expect(notice.header_type).toBe(approved.header_type);
    expect(notice.buttons).toEqual(approved.buttons);
  });

  it('carries no button that offers new inventory', () => {
    // "Send more details" elaborates the transaction in hand and is
    // approved as Utility on this account; "Send listings" and "Start
    // alerts" offer new inventory and were both re-filed as Marketing.
    const payload = buildEnquiryNoticeTemplatePayload();
    const labels = (payload.buttons ?? []).map((b) =>
      'text' in b ? b.text.toLowerCase() : ''
    );
    for (const label of labels) {
      expect(label).not.toMatch(/listing|alert|deal|offer|subscribe|browse/);
    }
    expect(payload.footer_text).toBeUndefined();
    expect((payload.buttons ?? []).every((b) => b.type === 'QUICK_REPLY')).toBe(
      true
    );
  });

  it('has three contiguous body variables with matching samples', () => {
    const payload = buildEnquiryNoticeTemplatePayload();
    const indices = [...payload.body_text.matchAll(/\{\{(\d+)\}\}/g)].map(
      (m) => m[1]
    );
    expect([...new Set(indices)]).toEqual(['1', '2', '3']);
    expect(payload.sample_values?.body).toHaveLength(3);
  });

  it('every button still routes to a webhook action via its text', () => {
    expect(isPreferenceFlowRequestText(ENQUIRY_NOTICE_UPDATE_BUTTON)).toBe(
      true
    );
    const texts = (buildEnquiryNoticeTemplatePayload().buttons ?? []).map(
      (b) => ('text' in b ? b.text : '')
    );
    expect(texts).toEqual([
      ENQUIRY_NOTICE_UPDATE_BUTTON,
      ENQUIRY_NOTICE_CLOSE_BUTTON,
    ]);
  });
});

describe('describeEnquiredProperty', () => {
  it('names the listing the way the lead would recognise it', () => {
    expect(
      describeEnquiredProperty(
        prop({
          title: 'Prestige Lakeside Habitat',
          bedrooms: 3,
          sublocality: 'Whitefield',
          city: 'Bangalore',
        })
      )
    ).toBe('3 BHK at Prestige Lakeside Habitat, Whitefield, Bangalore');
  });

  it('falls back to the plain location when no locality is set', () => {
    expect(
      describeEnquiredProperty(
        prop({ title: 'Green Acres', location: 'Devanahalli' })
      )
    ).toBe('Green Acres, Devanahalli');
  });

  it('omits the BHK prefix for land and commercial listings', () => {
    expect(
      describeEnquiredProperty(prop({ title: 'Plot 42', location: 'Mysore' }))
    ).toBe('Plot 42, Mysore');
  });
});

describe('buildEnquiryNoticeParams', () => {
  it('builds all three params, greeting by first name', () => {
    expect(
      buildEnquiryNoticeParams(
        'Praneeth Kumar',
        prop({
          title: 'Prestige Lakeside Habitat',
          bedrooms: 3,
          sublocality: 'Whitefield',
        }),
        'Aryavarta Ventures'
      )
    ).toEqual([
      'Praneeth',
      'Aryavarta Ventures',
      '3 BHK at Prestige Lakeside Habitat, Whitefield',
    ]);
  });

  it('never greets a placeholder lead name', () => {
    expect(
      buildEnquiryNoticeParams('Housing Lead', prop({ title: 'A' }))[0]
    ).toBe('there');
  });

  it('returns non-empty values even for a bare listing', () => {
    const params = buildEnquiryNoticeParams(
      null,
      prop({ title: '', location: '' })
    );
    expect(params.every((p) => p.length > 0)).toBe(true);
  });
});
