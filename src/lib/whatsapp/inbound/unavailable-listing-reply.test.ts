import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({
  alreadyTold: false,
  contactName: 'Ali Yousuff' as string | null,
  sends: [] as Record<string, unknown>[],
  contactLookups: 0,
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    state.sends.push(args);
    return { success: true };
  },
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseBrowseUrl: async () => 'https://aryavarta.convoreal.com/?v=c1',
}));

import { replyListingUnavailableOnce } from './unavailable-listing-reply';

function fakeDb() {
  return {
    from: (table: string) => {
      if (table === 'contacts') state.contactLookups += 1;
      const builder = {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data:
            table === 'contacts'
              ? { name: state.contactName }
              : table === 'messages' && state.alreadyTold
                ? { id: 'm-told' }
                : null,
          error: null,
        }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const args = {
  accountId: 'acc-1',
  userId: 'owner-1',
  contactId: 'c1',
  conversationId: 'conv-1',
  toPhone: '919900000000',
};

beforeEach(() => {
  state.alreadyTold = false;
  state.contactName = 'Ali Yousuff';
  state.sends = [];
  state.contactLookups = 0;
});

describe('replyListingUnavailableOnce', () => {
  it('[CNV-008] says nothing about a live or unverified listing', async () => {
    for (const status of ['Available', 'Pending Review', null]) {
      expect(
        await replyListingUnavailableOnce({
          db: fakeDb(),
          ...args,
          property: { title: 'Plot', status },
        })
      ).toBeNull();
    }
    expect(state.sends).toEqual([]);
    expect(state.contactLookups).toBe(0);
  });

  it('[CNV-008] sends the regret with the showcase link, as the bot, to the lead', async () => {
    const outcome = await replyListingUnavailableOnce({
      db: fakeDb(),
      ...args,
      property: {
        title: '#20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
        status: 'Under Contract',
      },
    });
    expect(outcome).toBe('sent');
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0]).toMatchObject({
      kind: 'text',
      senderType: 'bot',
      contactId: 'c1',
      conversationId: 'conv-1',
      toPhone: '919900000000',
    });
    const text = state.sends[0].text as string;
    expect(text).toMatch(/^Hi Ali, thank you for your interest in \*#20/);
    expect(text).toMatch(/under contract with another buyer/);
    expect(text).toMatch(/requirements and budget/);
    expect(text).toMatch(
      /Browse every live listing any time: https:\/\/aryavarta\.convoreal\.com\/\?v=c1$/
    );
  });

  it('[CNV-008] looks the lead up only when no name was given', async () => {
    await replyListingUnavailableOnce({
      db: fakeDb(),
      ...args,
      contactName: 'Shirish',
      property: { title: 'Plot', status: 'Sold' },
    });
    expect(state.contactLookups).toBe(0);
    expect(state.sends[0].text).toMatch(/^Hi Shirish,/);
    await replyListingUnavailableOnce({
      db: fakeDb(),
      ...args,
      property: { title: 'Plot', status: 'Sold' },
    });
    expect(state.contactLookups).toBe(1);
    expect(state.sends[1].text).toMatch(/^Hi Ali,/);
  });

  it('[CNV-008] sends nothing again to a lead who already holds the reply', async () => {
    state.alreadyTold = true;
    expect(
      await replyListingUnavailableOnce({
        db: fakeDb(),
        ...args,
        property: { title: 'Plot', status: 'Sold' },
      })
    ).toBe('already_told');
    expect(state.sends).toEqual([]);
  });
});
