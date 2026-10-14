import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  property: {
    id: 'p-20',
    title: '#20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
    status: 'Under Contract',
    price: 84000000,
    images: ['https://img/1.jpg'],
    type: 'Commercial Plot',
    sublocality: 'JP Nagar 4th Phase',
    city: 'Bangalore',
  } as Record<string, unknown>,
  listed: [] as Record<string, unknown>[],
  filters: [] as Record<string, unknown>[],
  regret: 'sent' as string | null,
  regrets: [] as Record<string, unknown>[],
  sends: [] as Record<string, unknown>[],
  shares: [] as unknown[],
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    state.sends.push(args);
    return { success: true };
  },
}));

vi.mock('@/lib/whatsapp/inbound/unavailable-listing-reply', () => ({
  replyListingUnavailableOnce: async (args: Record<string, unknown>) => {
    state.regrets.push(args);
    return state.regret;
  },
}));

vi.mock('@/lib/whatsapp/share-property-send', () => ({
  logPropertyShare: async (...args: unknown[]) => {
    state.shares.push(args);
    return true;
  },
}));

vi.mock('@/lib/whatsapp/listing-feedback', () => ({
  sendListingFeedbackPrompt: async () => true,
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountPropertyShowcaseUrl: async () =>
    'https://aryavarta.convoreal.com/?property_id=PROP-1004&v=c1',
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        neq: () => builder,
        order: () => builder,
        limit: async () => {
          state.filters.push({ table, ...filters });
          return { data: state.listed, error: null };
        },
        maybeSingle: async () => ({
          data:
            table === 'properties'
              ? state.property
              : table === 'showcase_settings'
                ? { currency: 'INR' }
                : null,
          error: null,
        }),
      };
      return builder;
    },
  }),
}));

import {
  handleBrowseAllProperties,
  handlePropertyShareYesReply,
} from './property-share-replies';

const send = () =>
  handlePropertyShareYesReply(
    'p-20',
    'acc-1',
    'owner-1',
    'c1',
    'conv-1',
    '919900000000'
  );

beforeEach(() => {
  state.regret = 'sent';
  state.regrets = [];
  state.sends = [];
  state.shares = [];
  state.filters = [];
  state.listed = [];
});

describe('handlePropertyShareYesReply', () => {
  it('[CNV-009] answers a details request for a listing that left the market with the regret, never its details', async () => {
    expect(await send()).toBe('unavailable');
    expect(state.regrets).toEqual([
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'owner-1',
        contactId: 'c1',
        conversationId: 'conv-1',
        toPhone: '919900000000',
        property: { title: state.property.title, status: 'Under Contract' },
      }),
    ]);
    expect(state.sends).toEqual([]);
    expect(state.shares).toEqual([]);
  });

  it('[CNV-009] still sends nothing else when the lead already held the regret', async () => {
    state.regret = 'already_told';
    expect(await send()).toBe('unavailable');
    expect(state.sends).toEqual([]);
  });

  it('[CNV-009] reports a regret that never reached the lead as a failed send', async () => {
    state.regret = 'failed';
    expect(await send()).toBe(false);
    expect(state.sends).toEqual([]);
    expect(state.shares).toEqual([]);
  });

  it('sends the photo, the details and the feedback prompt for a live listing', async () => {
    state.regret = null;
    expect(await send()).toBe(true);
    expect(state.sends.map((s) => s.kind)).toEqual(['media', 'text']);
    expect(state.sends[1].text).toContain('*Price:* ₹8.40 Cr');
    expect(state.sends[1].text).toContain(
      'https://aryavarta.convoreal.com/?property_id=PROP-1004&v=c1'
    );
    expect(state.shares).toHaveLength(1);
  });
});

describe('handleBrowseAllProperties', () => {
  it('[CNV-009] offers only listings that are still available', async () => {
    state.listed = [
      { id: 'p-1', title: 'Prime Commercial Site', price: 96000000 },
    ];
    await handleBrowseAllProperties(
      'acc-1',
      'owner-1',
      'c1',
      'conv-1',
      '919900000000'
    );
    expect(state.filters).toEqual([
      expect.objectContaining({
        table: 'properties',
        is_published: true,
        status: 'Available',
      }),
    ]);
    expect(state.sends[0]).toMatchObject({ kind: 'interactive' });
  });
});
