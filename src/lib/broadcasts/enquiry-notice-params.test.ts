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

function ctx(over: Partial<EnquiryNoticeContext> = {}): EnquiryNoticeContext {
  return {
    enquired: new Map(),
    enquiryText: new Map(),
    brandName: 'Aryavarta Ventures',
    templateName: ENQUIRY_NOTICE_TEMPLATE_NAME,
    ...over,
  };
}

describe('resolveEnquiryNoticeParams', () => {
  it('builds both params when the enquired property is known', () => {
    const result = resolveEnquiryNoticeParams(
      contact,
      ctx({
        enquired: new Map([
          [
            'c1',
            prop({
              title: 'Prestige Lakeside',
              bedrooms: 3,
              sublocality: 'Whitefield',
            }),
          ],
        ]),
      })
    );
    expect(result).toEqual({
      params: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK at Prestige Lakeside, Whitefield',
      ],
    });
  });

  it('falls back to the requirement text the portal wrote', () => {
    // The usual portal-lead case: the enquired listing was never in
    // inventory, but the note carries the enquiry in prose.
    const result = resolveEnquiryNoticeParams(
      contact,
      ctx({
        enquiryText: new Map([
          ['c1', '3 BHK Residential House for Sale in Koramangala, Bangalore'],
        ]),
      })
    );
    expect(result).toEqual({
      params: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK Residential House for Sale in Koramangala, Bangalore',
      ],
    });
  });

  it('prefers the resolved property over the note text', () => {
    // A resolved row is structured, current data; the note is prose
    // from the time of enquiry.
    const result = resolveEnquiryNoticeParams(
      contact,
      ctx({
        enquired: new Map([['c1', prop({ title: 'Prestige Lakeside' })]]),
        enquiryText: new Map([['c1', 'some old requirement']]),
      })
    );
    if ('failure' in result) throw new Error('expected params');
    expect(result.params[2]).toContain('Prestige Lakeside');
    expect(result.params[2]).not.toContain('old requirement');
  });

  it('refuses rather than sending "Property:" with nothing after it', () => {
    expect(resolveEnquiryNoticeParams(contact, ctx())).toEqual({
      failure: 'no_enquired_property',
    });
  });

  it('signs both paths with the brokerage', () => {
    // The lead has never messaged this number, so an unsigned notice
    // arrives from a stranger claiming to know about their enquiry.
    for (const over of [
      { enquired: new Map([['c1', prop({ title: 'Prestige Lakeside' })]]) },
      { enquiryText: new Map([['c1', '2 BHK in Whitefield']]) },
    ]) {
      const result = resolveEnquiryNoticeParams(contact, ctx(over));
      if ('failure' in result) throw new Error('expected params');
      expect(result.params[1]).toBe('Aryavarta Ventures');
    }
  });

  it('drops the brokerage param for the legacy name', () => {
    // The predecessor has no {{2}} for it, and Meta rejects a send
    // whose param count does not match the template.
    const result = resolveEnquiryNoticeParams(
      contact,
      ctx({
        enquired: new Map([['c1', prop({ title: 'Prestige Lakeside' })]]),
        templateName: 'property_enquiry_notice',
      })
    );
    if ('failure' in result) throw new Error('expected params');
    expect(result.params).toHaveLength(2);
    expect(result.params[1]).toContain('Prestige Lakeside');
  });

  it('the failure names the fix, not just the fault', () => {
    for (const reason of Object.values(ENQUIRY_NOTICE_FAILURE_REASONS)) {
      expect(reason).toMatch(/instead|import/i);
    }
  });

  it('greets a placeholder lead name as "there"', () => {
    const result = resolveEnquiryNoticeParams(
      { id: 'c1', name: 'Housing Lead' } as Pick<Contact, 'id' | 'name'>,
      ctx({ enquired: new Map([['c1', prop({ title: 'A' })]]) })
    );
    if ('params' in result) expect(result.params[0]).toBe('there');
    else throw new Error('expected params');
  });

  it('greets a placeholder lead as "there" on the text path too', () => {
    const result = resolveEnquiryNoticeParams(
      { id: 'c1', name: 'MagicBricks Lead' } as Pick<Contact, 'id' | 'name'>,
      ctx({ enquiryText: new Map([['c1', '2 BHK in Whitefield']]) })
    );
    if ('params' in result) expect(result.params[0]).toBe('there');
    else throw new Error('expected params');
  });
});
