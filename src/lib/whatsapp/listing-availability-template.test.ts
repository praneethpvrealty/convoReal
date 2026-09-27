import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import { LANGUAGE_CODES } from '@/lib/languages';
import {
  buildListingAvailabilityParams,
  buildListingAvailabilityTemplatePayload,
  listingAvailabilityStatusLabel,
  LISTING_AVAILABILITY_TEMPLATE_NAME,
  pickListingAvailabilityTemplate,
} from './listing-availability-template';
import { buildEnquiryNoticeTemplatePayload } from './enquiry-notice-template';
import { validateTemplatePayload } from './template-validators';

const property = {
  id: 'p1',
  title: 'Commercial Plot on 100 feet road',
  status: 'Under Contract',
  sublocality: 'JP Nagar 4th Phase',
  city: 'Bangalore',
} as Property;

describe('buildListingAvailabilityTemplatePayload', () => {
  it('[PRP-014] produces a payload the submit API accepts, as Utility, in every language', () => {
    for (const language of LANGUAGE_CODES) {
      const payload = buildListingAvailabilityTemplatePayload(language);
      expect(() => validateTemplatePayload(payload), language).not.toThrow();
      expect(payload.name).toBe(LISTING_AVAILABILITY_TEMPLATE_NAME);
      expect(payload.category).toBe('Utility');
      expect(payload.body_text.match(/\{\{\d\}\}/g), language).toEqual([
        '{{1}}',
        '{{2}}',
        '{{3}}',
        '{{4}}',
      ]);
      expect(payload.sample_values?.body).toHaveLength(4);
    }
  });

  it('[PRP-014] promises an update and asks for requirements and budget', () => {
    const body = buildListingAvailabilityTemplatePayload().body_text;
    expect(body).toContain('Status: {{4}}');
    expect(body).toContain('We are sorry');
    expect(body).toContain(
      'If it becomes available again, we will update you here.'
    );
    expect(body).toContain('reply with your requirements and budget');
    expect(body).not.toContain('no longer available');
  });

  it('changes nothing from the approved enquiry notice but the status line and the two sentences', () => {
    const notice = buildEnquiryNoticeTemplatePayload();
    const availability = buildListingAvailabilityTemplatePayload();
    const restored = availability.body_text
      .replace('Property: {{3}}\nStatus: {{4}}', 'Property: {{3}}')
      .replace(
        'We are sorry, the listing you enquired about is not available right now. If it becomes available again, we will update you here.',
        'The listing you enquired about is no longer available, so your enquiry cannot be fulfilled as filed.'
      )
      .replace(
        'reply with your requirements and budget',
        'reply with what you are looking for now'
      );
    expect(restored).toBe(notice.body_text);
    expect(availability.buttons).toEqual(notice.buttons);
    expect(availability.header_type).toBe(notice.header_type);
    expect(availability.footer_text).toBeUndefined();
  });
});

describe('listingAvailabilityStatusLabel', () => {
  it('names each status in the template language', () => {
    expect(listingAvailabilityStatusLabel('Under Contract')).toBe(
      'Under contract'
    );
    expect(listingAvailabilityStatusLabel('Off Market')).toBe(
      'Off the market for now'
    );
    expect(listingAvailabilityStatusLabel('Archived')).toBe(
      'Not actively listed'
    );
    expect(listingAvailabilityStatusLabel('Under Contract', 'hi')).toBe(
      'अनुबंध के तहत'
    );
    for (const language of LANGUAGE_CODES) {
      expect(listingAvailabilityStatusLabel('Rejected', language)).not.toBe('');
    }
  });
});

describe('buildListingAvailabilityParams', () => {
  it('fills all four params with the status in the template language', () => {
    expect(
      buildListingAvailabilityParams(
        'Sandeep Kumar',
        property,
        'Aryavarta',
        'en'
      )
    ).toEqual([
      'Sandeep',
      'Aryavarta',
      'Commercial Plot on 100 feet road, JP Nagar 4th Phase, Bangalore',
      'Under contract',
    ]);
    expect(
      buildListingAvailabilityParams('Sandeep', property, 'Aryavarta', 'ta')[3]
    ).toBe('ஒப்பந்த நிலையில் உள்ளது');
  });
});

describe('pickListingAvailabilityTemplate', () => {
  it('only picks an approved Utility row', () => {
    expect(
      pickListingAvailabilityTemplate([
        {
          name: LISTING_AVAILABILITY_TEMPLATE_NAME,
          status: 'PENDING',
          category: 'Utility',
        },
      ])
    ).toBeNull();
    expect(
      pickListingAvailabilityTemplate([
        {
          name: LISTING_AVAILABILITY_TEMPLATE_NAME,
          status: 'APPROVED',
          category: 'UTILITY',
        },
      ])?.name
    ).toBe(LISTING_AVAILABILITY_TEMPLATE_NAME);
  });

  it('never picks a row Meta filed as Marketing', () => {
    expect(
      pickListingAvailabilityTemplate([
        {
          name: LISTING_AVAILABILITY_TEMPLATE_NAME,
          status: 'APPROVED',
          category: 'MARKETING',
        },
      ])
    ).toBeNull();
  });
});
