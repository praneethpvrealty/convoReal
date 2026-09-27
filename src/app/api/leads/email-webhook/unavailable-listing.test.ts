import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(),
}));

vi.mock('@/lib/whatsapp/template-language', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/whatsapp/template-language')
  >()),
  resolveSendLanguage: vi.fn().mockResolvedValue('en'),
}));

import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { resolveSendLanguage } from '@/lib/whatsapp/template-language';
import { CUSTOMER_WINDOW_EXPIRED_MESSAGE } from '@/lib/whatsapp/customer-window';
import {
  enquiryNoticeSendParams,
  sendUnavailableListingReply,
} from './unavailable-listing';
import type { Property } from '@/types';

const send = vi.mocked(sendWhatsAppMessageAndPersist);

function fakeDb(tables: Record<string, unknown>) {
  return {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: tables[table] ?? null, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: tables[table] ?? null, error: null }).then(
            resolve
          ),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const property = {
  id: 'prop-20',
  title: '2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase',
  status: 'Under Contract',
  sublocality: 'JP Nagar 4th Phase',
  city: 'Bangalore',
} as Property;

const notice = {
  name: 'listing_status_notice',
  status: 'APPROVED',
  category: 'Utility',
  language: 'en',
  body_text: 'Hi {{1}}, update from {{2}}: Property: {{3}}',
};

const args = {
  accountId: 'acc-1',
  userId: 'user-1',
  contactId: 'contact-1',
  conversationId: 'conv-1',
  leadName: 'Sandeep',
  propertyId: 'prop-20',
};

describe('sendUnavailableListingReply', () => {
  beforeEach(() => send.mockReset());

  it('stays silent for an available listing', async () => {
    const supabase = fakeDb({
      properties: { ...property, status: 'Available' },
    });
    expect(await sendUnavailableListingReply({ supabase, ...args })).toBe(
      'available'
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('[PRP-014] tells a portal lead the listing is under contract and asks for requirements and budget', async () => {
    send.mockResolvedValue({ success: true });
    const supabase = fakeDb({ properties: property });
    expect(await sendUnavailableListingReply({ supabase, ...args })).toBe(
      'text'
    );
    const call = send.mock.calls[0][0];
    expect(call.kind).toBe('text');
    expect(call.senderType).toBe('bot');
    expect(call.text).toMatch(/Hi Sandeep/);
    expect(call.text).toMatch(/under contract/);
    expect(call.text).toMatch(/we'll come back and update you/);
    expect(call.text).toMatch(/requirements and budget/);
  });

  it('[PRP-014] falls back to the approved status notice outside the 24-hour window', async () => {
    send
      .mockResolvedValueOnce({
        success: false,
        error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
      })
      .mockResolvedValueOnce({ success: true });
    const supabase = fakeDb({
      properties: property,
      message_templates: [notice],
      accounts: { name: 'Aryavarta Ventures' },
    });
    expect(await sendUnavailableListingReply({ supabase, ...args })).toBe(
      'template'
    );
    const call = send.mock.calls[1][0];
    expect(call.kind).toBe('template');
    expect(call.templateName).toBe('listing_status_notice');
    expect(call.templateParams).toEqual([
      'Sandeep',
      'Aryavarta Ventures',
      '2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase, JP Nagar 4th Phase, Bangalore',
    ]);
    expect(call.text).toContain('update from Aryavarta Ventures');
    expect(resolveSendLanguage).toHaveBeenCalledWith(
      supabase,
      'acc-1',
      'contact-1'
    );
  });

  it('[CLG-001] sends the notice in the contact preferred language when one is approved', async () => {
    vi.mocked(resolveSendLanguage).mockResolvedValueOnce('hi');
    send
      .mockResolvedValueOnce({
        success: false,
        error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
      })
      .mockResolvedValueOnce({ success: true });
    const supabase = fakeDb({
      properties: property,
      message_templates: [
        notice,
        { ...notice, language: 'hi', body_text: 'नमस्ते {{1}}' },
      ],
      accounts: { name: 'Aryavarta Ventures' },
    });
    expect(await sendUnavailableListingReply({ supabase, ...args })).toBe(
      'template'
    );
    expect(send.mock.calls[1][0].templateLanguage).toBe('hi');
  });

  it('reports a closed window with no approved notice instead of failing silently', async () => {
    send.mockResolvedValueOnce({
      success: false,
      error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
    });
    const supabase = fakeDb({ properties: property, message_templates: [] });
    expect(await sendUnavailableListingReply({ supabase, ...args })).toBe(
      'no_template'
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('enquiryNoticeSendParams', () => {
  it('drops the brokerage for the legacy two-param notice', () => {
    expect(
      enquiryNoticeSendParams(
        'property_enquiry_notice',
        'Sandeep',
        property,
        'Aryavarta'
      )
    ).toHaveLength(2);
    expect(
      enquiryNoticeSendParams(
        'listing_status_notice',
        'Sandeep',
        property,
        'Aryavarta'
      )
    ).toHaveLength(3);
  });
});
