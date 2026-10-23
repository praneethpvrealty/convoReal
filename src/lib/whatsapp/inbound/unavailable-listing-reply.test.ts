import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({
  alreadyTold: false,
  contactName: 'Ali Yousuff' as string | null,
  sends: [] as Record<string, unknown>[],
  sendResult: { success: true } as Record<string, unknown>,
  contactLookups: 0,
  briefOnFile: false,
  confirmCards: [] as Record<string, unknown>[],
  toldFilters: [] as unknown[],
}));

vi.mock('@/lib/whatsapp/unavailable-brief-followup', () => ({
  hasRequirementOnFile: async () => state.briefOnFile,
  sendRequirementConfirmAfterRegret: async (args: Record<string, unknown>) => {
    state.confirmCards.push(args);
    return state.briefOnFile;
  },
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    state.sends.push(args);
    return state.sendResult;
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
        in: (_column: string, value: unknown) => {
          state.toldFilters.push(value);
          return builder;
        },
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
  state.sendResult = { success: true };
  state.contactLookups = 0;
  state.briefOnFile = false;
  state.confirmCards = [];
  state.toldFilters = [];
});

describe('replyListingUnavailableOnce', () => {
  it('[CNV-009] says nothing about a live or unverified listing', async () => {
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

  it('[CNV-009] sends the regret with the showcase link, as the bot, to the lead', async () => {
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

  it('[CNV-009] looks the lead up only when no name was given', async () => {
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

  it('[CNV-009] reports a regret the lead never received as failed, and one Meta accepted as sent', async () => {
    state.sendResult = { success: false, error: 'boom' };
    expect(
      await replyListingUnavailableOnce({
        db: fakeDb(),
        ...args,
        property: { title: 'Plot', status: 'Sold' },
      })
    ).toBe('failed');
    state.sendResult = { success: false, reachedMeta: true, error: 'ledger' };
    expect(
      await replyListingUnavailableOnce({
        db: fakeDb(),
        ...args,
        property: { title: 'Plot', status: 'Sold' },
      })
    ).toBe('sent');
  });

  it('[PRP-049] offers to confirm a brief on file, then plays it back to confirm', async () => {
    state.briefOnFile = true;
    const outcome = await replyListingUnavailableOnce({
      db: fakeDb(),
      ...args,
      contactName: 'Ramanathan',
      property: { title: 'Plot', status: 'Sold' },
    });
    expect(outcome).toBe('sent');
    expect(state.sends[0].text).toMatch(
      /I already have your requirement on file/
    );
    expect(state.sends[0].text).not.toMatch(
      /share your requirements and budget/
    );
    expect(state.confirmCards).toEqual([
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'owner-1',
        contactId: 'c1',
        conversationId: 'conv-1',
      }),
    ]);
  });

  it('[PRP-049] asks for requirements and budget, and plays nothing back, with nothing on file', async () => {
    await replyListingUnavailableOnce({
      db: fakeDb(),
      ...args,
      contactName: 'Ramanathan',
      property: { title: 'Plot', status: 'Sold' },
    });
    expect(state.sends[0].text).toMatch(/share your requirements and budget/);
    expect(state.confirmCards).toHaveLength(1);
  });

  it('[PRP-049] counts the regret as already sent whichever nudge it carried', async () => {
    state.briefOnFile = true;
    await replyListingUnavailableOnce({
      db: fakeDb(),
      ...args,
      contactName: 'Ramanathan',
      property: { title: 'Plot', status: 'Sold' },
    });
    const [variants] = state.toldFilters as string[][];
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatch(/I already have your requirement on file/);
    expect(variants[1]).toMatch(/share your requirements and budget/);
    expect(variants).toContain(state.sends[0].text);
    state.alreadyTold = true;
    state.briefOnFile = false;
    expect(
      await replyListingUnavailableOnce({
        db: fakeDb(),
        ...args,
        contactName: 'Ramanathan',
        property: { title: 'Plot', status: 'Sold' },
      })
    ).toBe('already_told');
    expect(state.sends).toHaveLength(1);
  });

  it('[CNV-009] sends nothing again to a lead who already holds the reply', async () => {
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
