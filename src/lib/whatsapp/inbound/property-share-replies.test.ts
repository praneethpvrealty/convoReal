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
  journeyInterest: [] as Record<string, unknown>[],
  regret: 'sent' as string | null,
  regrets: [] as Record<string, unknown>[],
  sends: [] as Record<string, unknown>[],
  shares: [] as unknown[],
  failInteractive: false,
  inserts: [] as Record<string, unknown>[],
  mirrors: [] as Record<string, unknown>[],
  linked: false,
  likeError: null as { code: string } | null,
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    state.sends.push(args);
    return {
      success: !(state.failInteractive && args.kind === 'interactive'),
    };
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

vi.mock('@/lib/journey/lead-interest', () => ({
  recordJourneyLeadInterest: async (
    _db: unknown,
    args: Record<string, unknown>
  ) => {
    state.journeyInterest.push(args);
    return { itemId: 'ji-1', error: null };
  },
}));

vi.mock('@/lib/buyer/shared-listings', () => ({
  mirrorSharedListingsToPortfolio: async (
    _db: unknown,
    args: Record<string, unknown>
  ) => {
    state.mirrors.push(args);
    return { linked: state.linked, saved: state.linked ? 1 : 0 };
  },
  portfolioLoginUrl: () => 'https://www.convoreal.com/buyer/login',
  buildPortfolioNudge: (args: { linked: boolean }) =>
    args.linked ? 'In your Portfolio too.' : 'Sign in to your Portfolio.',
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
        or: () => builder,
        order: () => builder,
        insert: async (row: Record<string, unknown>) => {
          state.inserts.push({ table, ...row });
          return { error: state.likeError };
        },
        upsert: async (
          row: Record<string, unknown>,
          opts?: { onConflict?: string }
        ) => {
          state.inserts.push({ table, ...row, onConflict: opts?.onConflict });
          return { error: state.likeError };
        },
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
  handleShortlistPropertyReply,
  handleShowMoreProperties,
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
  state.journeyInterest = [];
  state.shares = [];
  state.filters = [];
  state.listed = [];
  state.failInteractive = false;
  state.inserts = [];
  state.mirrors = [];
  state.linked = false;
  state.likeError = null;
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

const PROPERTY_ID = '0b5f6a52-2d8c-4f4e-9a51-3f6f8a1b2c3d';

describe('handleShowMoreProperties', () => {
  const showMore = () =>
    handleShowMoreProperties(
      'p-20',
      'acc-1',
      'owner-1',
      'c1',
      'conv-1',
      '919900000000'
    );

  it('[INB-036] sends each similar listing as one photo card with Shortlist and Interested buttons', async () => {
    state.listed = [
      {
        id: PROPERTY_ID,
        title: 'G+2 Residential House on 60x45 Plot',
        price: 97200000,
        images: ['', 'https://img/house.jpg'],
        sublocality: 'JP Nagar',
        city: 'Bengaluru',
      },
    ];
    await showMore();
    expect(state.sends.map((s) => s.kind)).toEqual([
      'text',
      'interactive',
      'interactive',
    ]);
    expect(state.sends[1]).toMatchObject({
      interactiveType: 'buttons',
      headerImageLink: 'https://img/house.jpg',
      interactiveButtons: [
        { id: `shortlist_property:${PROPERTY_ID}`, title: '⭐ Shortlist' },
        { id: `lfb_y_${PROPERTY_ID}`, title: '👍 Interested' },
      ],
    });
    expect(state.sends[1].interactiveBody).toContain(
      '🏠 *G+2 Residential House on 60x45 Plot*'
    );
    expect(state.sends[1].interactiveBody).toContain(
      'https://aryavarta.convoreal.com/?property_id=PROP-1004&v=c1'
    );
  });

  it('[INB-036] keeps the whole showcase link when a long listing is trimmed to fit the card', async () => {
    state.listed = [
      {
        id: PROPERTY_ID,
        title: 'Plot '.repeat(150),
        price: 97200000,
        images: ['https://img/house.jpg'],
        location: 'Near the lake '.repeat(60),
      },
    ];
    await showMore();
    const body = state.sends[1].interactiveBody as string;
    expect(body.length).toBeLessThanOrEqual(1024);
    expect(
      body.endsWith(
        'https://aryavarta.convoreal.com/?property_id=PROP-1004&v=c1'
      )
    ).toBe(true);
  });

  it('[INB-036] falls back to the photo and the details text when the card cannot be sent', async () => {
    state.failInteractive = true;
    state.listed = [
      {
        id: PROPERTY_ID,
        title: 'G+2 Residential House on 60x45 Plot',
        price: 97200000,
        images: ['https://img/house.jpg'],
      },
    ];
    await showMore();
    expect(state.sends.map((s) => s.kind)).toEqual([
      'text',
      'interactive',
      'media',
      'text',
      'interactive',
    ]);
    expect(state.sends[2]).toMatchObject({
      mediaLink: 'https://img/house.jpg',
      mediaCaption: 'G+2 Residential House on 60x45 Plot',
    });
    expect(state.sends[3].text).toContain('*Price:*');
  });
});

describe('handleShortlistPropertyReply', () => {
  const shortlist = (id = PROPERTY_ID) =>
    handleShortlistPropertyReply(
      id,
      'acc-1',
      'owner-1',
      'c1',
      'conv-1',
      '919900000000'
    );

  it("[INB-036] saves the listing as the contact's like, mirrors it to Portfolio and confirms by name", async () => {
    state.regret = null;
    state.linked = true;
    expect(await shortlist()).toBe(true);
    expect(state.inserts).toEqual([
      {
        table: 'property_likes',
        account_id: 'acc-1',
        property_id: PROPERTY_ID,
        contact_id: 'c1',
        session_key: 'wa:c1',
        created_at: expect.any(String),
        updated_at: expect.any(String),
        onConflict: 'session_key,property_id',
      },
    ]);
    expect(state.mirrors).toEqual([
      { accountId: 'acc-1', contactId: 'c1', propertyIds: [PROPERTY_ID] },
    ]);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].interactiveBody).toContain(
      `Saved *${state.property.title}* to your shortlist`
    );
    expect(state.sends[0].interactiveBody).toContain('In your Portfolio too.');
    expect(state.sends[0].interactiveButtons).toEqual([
      { id: `lfb_y_${PROPERTY_ID}`, title: '👍 Interested' },
    ]);
    expect(state.journeyInterest).toEqual([
      {
        accountId: 'acc-1',
        userId: 'owner-1',
        contactId: 'c1',
        propertyId: PROPERTY_ID,
        source: 'whatsapp_shortlist',
      },
    ]);
  });

  it('[INB-036] never confirms a save that failed', async () => {
    state.regret = null;
    state.likeError = { code: '57014' };
    expect(await shortlist()).toBe(true);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].kind).toBe('text');
    expect(state.sends[0].text).toContain("couldn't save");
    expect(JSON.stringify(state.sends)).not.toContain('Saved');
    expect(state.journeyInterest).toEqual([]);
  });

  it('[JRN-026] leaves the journey unstamped when only the Portfolio mirror saved the tap', async () => {
    state.regret = null;
    state.likeError = { code: '57014' };
    state.linked = true;
    expect(await shortlist()).toBe(true);
    expect(JSON.stringify(state.sends)).not.toContain("couldn't save");
    expect(state.journeyInterest).toEqual([]);
  });

  it('[INB-036] [JRN-026] a re-tap refreshes the like, so a Shortlist after a no counts again live and on file', async () => {
    state.regret = null;
    const before = Date.now();
    expect(await shortlist()).toBe(true);
    const like = state.inserts[0];
    expect(like.onConflict).toBe('session_key,property_id');
    expect(Date.parse(like.created_at as string)).toBeGreaterThanOrEqual(
      before
    );
    expect(like.updated_at).toBe(like.created_at);
    expect(state.journeyInterest).toHaveLength(1);
    expect(state.sends[0].interactiveBody).toContain('to your shortlist');
  });

  it('[INB-036] [CNV-009] saves nothing for a listing that left the market', async () => {
    expect(await shortlist()).toBe(true);
    expect(state.regrets).toHaveLength(1);
    expect(state.inserts).toEqual([]);
    expect(state.sends).toEqual([]);
    expect(state.journeyInterest).toEqual([]);
  });

  it('[INB-036] ignores a tap whose id is not a property uuid', async () => {
    expect(await shortlist('not-a-uuid')).toBe(false);
    expect(state.inserts).toEqual([]);
    expect(state.sends).toEqual([]);
  });
});
