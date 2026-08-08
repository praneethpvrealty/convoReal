import { describe, it, expect } from 'vitest';
import type { Contact, Property } from '@/types';
import {
  resolveEnquiryNoticeParams,
  ENQUIRY_NOTICE_FAILURE_REASONS,
  type EnquiryNoticeContext,
} from './enquiry-notice-params';
import { ENQUIRY_NOTICE_TEMPLATE_NAME } from '@/lib/whatsapp/enquiry-notice-template';

function prop(overrides: Partial<Property>): Property {
  return {
    id: 'p1',
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

const contact = { id: 'c1', name: 'Praneeth' } as Pick<Contact, 'id' | 'name'>;

describe('resolveEnquiryNoticeParams', () => {
  const known = () =>
    new Map([
      [
        'c1',
        prop({
          title: 'Prestige Lakeside',
          bedrooms: 3,
          sublocality: 'Whitefield',
        }),
      ],
    ]);

  it('signs the notice with the brokerage when the property is known', () => {
    expect(
      resolveEnquiryNoticeParams(contact, {
        enquired: known(),
        brandName: 'Aryavarta Ventures',
        templateName: ENQUIRY_NOTICE_TEMPLATE_NAME,
      })
    ).toEqual({
      params: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK at Prestige Lakeside, Whitefield',
      ],
    });
  });

  it('drops the brokerage param for the legacy name', () => {
    // The predecessor has no {{2}} for it, and Meta rejects a send
    // whose param count does not match the template.
    expect(
      resolveEnquiryNoticeParams(contact, {
        enquired: known(),
        brandName: 'Aryavarta Ventures',
        templateName: 'property_enquiry_notice',
      })
    ).toEqual({
      params: ['Praneeth', '3 BHK at Prestige Lakeside, Whitefield'],
    });
  });

  it('refuses rather than sending "Property:" with nothing after it', () => {
    const ctx: EnquiryNoticeContext = { enquired: new Map() };
    expect(resolveEnquiryNoticeParams(contact, ctx)).toEqual({
      failure: 'no_enquired_property',
    });
  });

  it('the failure names the fix, not just the fault', () => {
    for (const reason of Object.values(ENQUIRY_NOTICE_FAILURE_REASONS)) {
      expect(reason).toMatch(/instead|import/i);
    }
  });

  it('greets a placeholder lead name as "there"', () => {
    const result = resolveEnquiryNoticeParams(
      { id: 'c1', name: 'Housing Lead' } as Pick<Contact, 'id' | 'name'>,
      { enquired: new Map([['c1', prop({ title: 'A' })]]) }
    );
    if ('params' in result) expect(result.params[0]).toBe('there');
    else throw new Error('expected params');
  });
});
