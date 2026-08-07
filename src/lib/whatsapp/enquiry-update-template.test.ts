import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  buildEnquiryUpdateTemplatePayload,
  buildEnquiryUpdateParams,
  describeEnquiredProperty,
  ENQUIRY_UPDATE_TEMPLATE_NAME,
  ENQUIRY_UPDATE_LISTINGS_BUTTON,
  ENQUIRY_UPDATE_PREFERENCES_BUTTON,
  ENQUIRY_UPDATE_CLOSE_BUTTON,
} from './enquiry-update-template';
import { validateTemplatePayload } from './template-validators';
import { isPreferenceFlowRequestText } from './preference-flow';
import { parseBuyerMatchesCommand } from '@/lib/buyer/digest';

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

describe('buildEnquiryUpdateTemplatePayload', () => {
  it('produces a payload the submit API accepts, as Utility', () => {
    const payload = buildEnquiryUpdateTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(ENQUIRY_UPDATE_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
  });

  it('has two contiguous body variables with matching samples', () => {
    const payload = buildEnquiryUpdateTemplatePayload();
    const indices = [...payload.body_text.matchAll(/\{\{(\d+)\}\}/g)].map(
      (m) => m[1]
    );
    expect([...new Set(indices)]).toEqual(['1', '2']);
    expect(payload.sample_values?.body).toHaveLength(2);
  });

  it('volunteers nothing the recipient did not ask for', () => {
    // The rule four approvals on this account established: Meta re-files
    // a Utility submission as Marketing when the message is
    // unsolicited, not when it uses particular words. No replacement
    // listing, no price, no invitation to subscribe.
    const payload = buildEnquiryUpdateTemplatePayload();
    expect(payload.body_text).not.toMatch(
      /closest match|alternative|similar|we also have|would you like|updates when/i
    );
    expect(payload.body_text).not.toMatch(/₹|\bCr\b|\bLakhs\b/);
    expect(payload.footer_text).toBeUndefined();
    expect((payload.buttons ?? []).every((b) => b.type === 'QUICK_REPLY')).toBe(
      true
    );
  });

  it('keeps the labelled transaction-notice shape the approved templates use', () => {
    const payload = buildEnquiryUpdateTemplatePayload();
    expect(payload.body_text).toContain('Property: {{2}}');
    expect(payload.body_text).toContain('Status: No longer available');
  });

  it('every button routes to a webhook action via its text', () => {
    // Template taps arrive as message.button.text, so each label must
    // satisfy the parser that drives it.
    expect(parseBuyerMatchesCommand(ENQUIRY_UPDATE_LISTINGS_BUTTON)).toBe(true);
    expect(isPreferenceFlowRequestText(ENQUIRY_UPDATE_PREFERENCES_BUTTON)).toBe(
      true
    );
    const texts = (buildEnquiryUpdateTemplatePayload().buttons ?? []).map(
      (b) => ('text' in b ? b.text : '')
    );
    expect(texts).toEqual([
      ENQUIRY_UPDATE_LISTINGS_BUTTON,
      ENQUIRY_UPDATE_PREFERENCES_BUTTON,
      ENQUIRY_UPDATE_CLOSE_BUTTON,
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

describe('buildEnquiryUpdateParams', () => {
  it('builds both params, greeting by first name', () => {
    expect(
      buildEnquiryUpdateParams(
        'Praneeth Kumar',
        prop({
          title: 'Prestige Lakeside Habitat',
          bedrooms: 3,
          sublocality: 'Whitefield',
        })
      )
    ).toEqual(['Praneeth', '3 BHK at Prestige Lakeside Habitat, Whitefield']);
  });

  it('never greets a placeholder lead name', () => {
    expect(
      buildEnquiryUpdateParams('Housing Lead', prop({ title: 'A' }))[0]
    ).toBe('there');
  });

  it('returns non-empty values even for a bare listing', () => {
    const params = buildEnquiryUpdateParams(
      null,
      prop({ title: '', location: '' })
    );
    expect(params.every((p) => p.length > 0)).toBe(true);
  });
});
