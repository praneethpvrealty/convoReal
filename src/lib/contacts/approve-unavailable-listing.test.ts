import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Property } from '@/types';

const state = vi.hoisted(() => ({
  conversation: null as { id: string } | null,
  conversationsInOrder: [] as ({ id: string } | null)[],
  sameReply: false,
  noticeTexts: [] as string[],
  outcome: 'text' as string,
  sends: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/conversations/resolve', () => ({
  findConversation: async () =>
    state.conversationsInOrder.length
      ? state.conversationsInOrder.shift()
      : state.conversation,
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseBrowseUrl: async () => 'https://aryavarta.convoreal.com/?v=c1',
}));

vi.mock('@/app/api/leads/email-webhook/unavailable-listing', () => ({
  sendUnavailableListingReply: async (args: Record<string, unknown>) => {
    state.sends.push(args);
    return state.outcome;
  },
}));

import { tellApprovedLeadListingUnavailable } from './approve-unavailable-listing';

function fakeDb() {
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        neq: () => builder,
        in: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => ({
          data:
            table === 'messages' && 'content_text' in filters && state.sameReply
              ? { id: 'm-told' }
              : null,
          error: null,
        }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({
            data:
              table === 'messages' && 'template_name' in filters
                ? state.noticeTexts.map((content_text) => ({ content_text }))
                : [],
            error: null,
          }).then(resolve),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const property = {
  id: 'prop-20',
  title: '#20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
  status: 'Under Contract',
  sublocality: 'JP Nagar 4th Phase',
  city: 'Bangalore',
} as Property;

const args = {
  accountId: 'acc-1',
  userId: 'user-1',
  contactId: 'c1',
  contactName: 'Ali Yousuff',
};

beforeEach(() => {
  state.conversation = { id: 'conv-1' };
  state.conversationsInOrder = [];
  state.sameReply = false;
  state.noticeTexts = [];
  state.outcome = 'text';
  state.sends = [];
});

describe('tellApprovedLeadListingUnavailable', () => {
  it('[CNV-007] stays out of the way of an available or unverified listing', async () => {
    for (const status of ['Available', 'Pending Review', null]) {
      expect(
        await tellApprovedLeadListingUnavailable({
          db: fakeDb(),
          ...args,
          property: { ...property, status } as Property,
        })
      ).toBeNull();
    }
    expect(state.sends).toEqual([]);
  });

  it('[CNV-007] sends the regret with the showcase link instead of the details', async () => {
    const outcome = await tellApprovedLeadListingUnavailable({
      db: fakeDb(),
      ...args,
      property,
    });
    expect(outcome).toMatchObject({
      status: 'Under Contract',
      label: 'Under contract',
      notice: 'freeform',
      conversationId: 'conv-1',
    });
    expect(outcome?.message).toMatch(/^Hi Ali, thank you for your interest/);
    expect(outcome?.message).toMatch(/under contract with another buyer/);
    expect(outcome?.message).toMatch(
      /Browse every live listing any time: https:\/\/aryavarta\.convoreal\.com\/\?v=c1$/
    );
    expect(state.sends).toEqual([
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'user-1',
        contactId: 'c1',
        conversationId: 'conv-1',
        leadName: 'Ali Yousuff',
        propertyId: 'prop-20',
        templateFallback: true,
      }),
    ]);
  });

  it('[CNV-007] sends nothing again to a lead who already holds that exact reply', async () => {
    state.sameReply = true;
    const outcome = await tellApprovedLeadListingUnavailable({
      db: fakeDb(),
      ...args,
      property,
    });
    expect(outcome?.notice).toBe('already_told');
    expect(state.sends).toEqual([]);
  });

  it('[CNV-007] withholds the status notice template from a lead who already holds it for this listing', async () => {
    state.noticeTexts = [
      'Hi Ali, this is a status update on your property enquiry with Aryavarta Ventures:\n\nProperty: #20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase, Bangalore',
    ];
    state.outcome = 'window_closed';
    const outcome = await tellApprovedLeadListingUnavailable({
      db: fakeDb(),
      ...args,
      property,
    });
    expect(state.sends[0]).toMatchObject({ templateFallback: false });
    expect(outcome?.notice).toBe('already_told');
  });

  it('[CNV-007] still sends the notice when the one they hold names another listing', async () => {
    state.noticeTexts = [
      'Hi Ali, this is a status update on your property enquiry with Aryavarta Ventures:\n\nProperty: 3 BHK at Prestige Lakeside Habitat, Whitefield',
    ];
    state.outcome = 'template';
    const outcome = await tellApprovedLeadListingUnavailable({
      db: fakeDb(),
      ...args,
      property,
    });
    expect(state.sends[0]).toMatchObject({ templateFallback: true });
    expect(outcome?.notice).toBe('template');
  });

  it('[CNV-007] reports a closed window with no approved notice, and a failed send, apart', async () => {
    state.outcome = 'no_template';
    expect(
      (
        await tellApprovedLeadListingUnavailable({
          db: fakeDb(),
          ...args,
          property,
        })
      )?.notice
    ).toBe('none');
    state.outcome = 'failed';
    expect(
      (
        await tellApprovedLeadListingUnavailable({
          db: fakeDb(),
          ...args,
          property,
        })
      )?.notice
    ).toBe('failed');
  });

  it('[CNV-007] hands back the conversation the first message opened for a lead with no thread yet', async () => {
    state.conversationsInOrder = [null, { id: 'conv-new' }];
    const outcome = await tellApprovedLeadListingUnavailable({
      db: fakeDb(),
      ...args,
      property,
    });
    expect(state.sends[0]).toMatchObject({ conversationId: null });
    expect(outcome?.conversationId).toBe('conv-new');
  });

  it('falls through to the details when the listing became available meanwhile', async () => {
    state.outcome = 'available';
    expect(
      await tellApprovedLeadListingUnavailable({
        db: fakeDb(),
        ...args,
        property,
      })
    ).toBeNull();
  });
});
