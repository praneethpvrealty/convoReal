import { describe, it, expect } from 'vitest';
import type { Contact, Property } from '@/types';
import {
  resolveEnquiryUpdateParams,
  ENQUIRY_UPDATE_FAILURE_REASONS,
  type EnquiryUpdateContext,
} from './enquiry-update-params';

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

describe('resolveEnquiryUpdateParams', () => {
  it('builds both params when the enquired property is known', () => {
    const result = resolveEnquiryUpdateParams(contact, {
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
    });
    expect(result).toEqual({
      params: ['Praneeth', '3 BHK at Prestige Lakeside, Whitefield'],
    });
  });

  it('refuses rather than sending "Property:" with nothing after it', () => {
    const ctx: EnquiryUpdateContext = { enquired: new Map() };
    expect(resolveEnquiryUpdateParams(contact, ctx)).toEqual({
      failure: 'no_enquired_property',
    });
  });

  it('the failure names the fix, not just the fault', () => {
    for (const reason of Object.values(ENQUIRY_UPDATE_FAILURE_REASONS)) {
      expect(reason).toMatch(/instead|import/i);
    }
  });

  it('greets a placeholder lead name as "there"', () => {
    const result = resolveEnquiryUpdateParams(
      { id: 'c1', name: 'Housing Lead' } as Pick<Contact, 'id' | 'name'>,
      { enquired: new Map([['c1', prop({ title: 'A' })]]) }
    );
    if ('params' in result) expect(result.params[0]).toBe('there');
    else throw new Error('expected params');
  });
});
