import { describe, it, expect, vi, beforeEach } from 'vitest';

// The free-text listener end to end: a buyer's typed message updates
// their requirement, and what happens next depends on who owns the
// thread — a human agent (bot listens, stays quiet), or the bot
// (answer with matches or the playback card). These pin the guard
// change: a bot-heavy thread with no human in it must still get an
// answer, which the old count-of-bot-messages cap silenced.

const sendTextMessage = vi.fn();
const saveBotMessage = vi.fn();
const rankPropertiesForContact = vi.fn();
const generateMatchEventForContact = vi.fn();
const recordLearnedFacts = vi.fn();
const sendRequirementReview = vi.fn();
const extractContactPreferences = vi.fn();

let queues: Record<string, unknown[]> = {};
let updates: { table: string; payload: Record<string, unknown> }[] = [];
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let filterCalls: { table: string; method: string; args: unknown[] }[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: true, error: null };
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gt', 'limit', 'delete']) {
        chain[m] = () => chain;
      }
      for (const m of ['or', 'order']) {
        chain[m] = (...args: unknown[]) => {
          filterCalls.push({ table, method: m, args });
          return chain;
        };
      }
      chain.update = (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return chain;
      };
      chain.maybeSingle = async () => ({
        data: (queues[table] ?? []).shift() ?? null,
      });
      (chain as { then?: unknown }).then = (r: (v: unknown) => unknown) => {
        const next = (queues[table] ?? []).shift() ?? null;
        // A head:true count query answers with a count and no rows.
        const isCount =
          !!next && !Array.isArray(next) && 'count' in (next as object);
        return Promise.resolve(
          r(
            isCount
              ? { data: null, error: null, ...(next as object) }
              : { data: next, error: null }
          )
        );
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (...args: unknown[]) => sendTextMessage(...args),
}));

vi.mock('@/lib/ai/chatbot-engine', () => ({
  saveBotMessage: (...args: unknown[]) => saveBotMessage(...args),
}));

vi.mock('@/lib/radar/engine', () => ({
  rankPropertiesForContact: (...args: unknown[]) =>
    rankPropertiesForContact(...args),
  generateMatchEventForContact: (...args: unknown[]) =>
    generateMatchEventForContact(...args),
}));

vi.mock('@/lib/learning/record', () => ({
  recordLearnedFacts: (...args: unknown[]) => recordLearnedFacts(...args),
}));

vi.mock('@/lib/whatsapp/requirement-review', () => ({
  sendRequirementReview: (...args: unknown[]) => sendRequirementReview(...args),
}));

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: vi.fn(async () => ({})),
}));

vi.mock('@/lib/ai/preference-extraction', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/ai/preference-extraction')>();
  return {
    ...original,
    extractContactPreferences: (...args: unknown[]) =>
      extractContactPreferences(...args),
  };
});

const { processBuyerQualificationMessage } =
  await import('./buyer-qualification');
const { EMPTY_PREFERENCES, buildPreferenceSourceText, preferenceSourceHash } =
  await import('./preference-extraction');

const fullPrefs = {
  ...EMPTY_PREFERENCES,
  property_types: ['Commercial Land'],
  listing_types: ['Sale' as const],
  budget_max: 20_000_000,
  areas: ['Koramangala'],
};

function contactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'Aryan',
    classification: 'Buyer',
    requirement_active: true,
    pref_source_hash: 'old-hash',
    contact_notes: [],
    contact_tags: [],
    ...overrides,
  };
}

const run = (ownerUserId?: string) =>
  processBuyerQualificationMessage(
    'budget is 2 cr now',
    { id: 'c1', phone: '919000000000', name: 'Aryan' },
    { id: 'conv-1' },
    'acct-1',
    'token',
    'phone-id',
    ownerUserId
  );

beforeEach(() => {
  vi.clearAllMocks();
  updates = [];
  rpcCalls = [];
  filterCalls = [];
  sendTextMessage.mockResolvedValue({ messageId: 'wamid.1' });
  generateMatchEventForContact.mockResolvedValue(undefined);
  rankPropertiesForContact.mockResolvedValue([]);
  recordLearnedFacts.mockResolvedValue({ applied: [], proposed: [] });
  sendRequirementReview.mockResolvedValue(true);
  extractContactPreferences.mockResolvedValue(fullPrefs);
  queues = {
    whatsapp_config: [{ auto_qualify_leads: true }],
    contacts: [contactRow()],
    messages: [
      // Six bot messages — a normal tap-driven thread, no human in it.
      Array.from({ length: 6 }, () => ({ sender_type: 'bot' })),
    ],
    properties: [[]],
  };
});

describe('processBuyerQualificationMessage — free-text requirement updates', () => {
  it('treats a bare live-inventory locality as a refinement and sends its matches', async () => {
    queues.contacts = [
      contactRow({
        requirements: 'Residential plot or house in Koramangala',
        pref_property_categories: ['residential'],
        pref_listing_types: ['Sale'],
        pref_budget_max: 20_000_000,
        pref_areas: ['Koramangala'],
      }),
    ];
    queues.messages = [
      [
        { sender_type: 'customer', content_text: 'Domluru' },
        { sender_type: 'bot', content_text: 'Here are 3 matching options' },
      ],
    ];
    queues.properties = [
      [
        {
          locality_canonical: null,
          sublocality: 'Domluru',
          project: null,
          type: 'Commercial Building',
        },
        {
          locality_canonical: 'Domlur',
          sublocality: 'Domlur',
          project: null,
          type: 'Residential Plot',
        },
      ],
    ];
    extractContactPreferences.mockResolvedValue({
      ...fullPrefs,
      property_categories: ['residential'],
      areas: ['Koramangala', 'Domlur'],
    });
    rankPropertiesForContact.mockResolvedValue([
      {
        property: {
          id: 'p-domlur',
          title: 'Residential Plot in Domlur',
          type: 'Residential Land/ Plot',
          price: 18_000_000,
          location: 'Domlur',
          city: 'Bangalore',
        },
        score: 90,
        details: {},
      },
    ]);

    const handled = await processBuyerQualificationMessage(
      'Domluru',
      { id: 'c1', phone: '919000000000', name: 'Saurav' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1'
    );

    expect(handled).toBe(true);
    expect(extractContactPreferences).toHaveBeenCalledWith(
      expect.stringContaining('Preferred location: Domlur')
    );
    expect(recordLearnedFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: expect.arrayContaining([
          { field: 'pref_areas', value: ['Domlur'] },
        ]),
      })
    );
    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Residential Plot in Domlur'),
      })
    );
  });

  it('serves the rent-to-sale correction instead of restarting onboarding', async () => {
    extractContactPreferences.mockResolvedValue({
      ...fullPrefs,
      property_categories: ['commercial'],
      listing_types: ['Sale', 'Rent'],
      budget_max: null,
      areas: [],
    });
    queues.contacts = [
      contactRow({
        name: 'Sulekha',
        requirements: 'Commercial office space for rent in Jayanagar',
        pref_property_categories: ['commercial'],
        pref_listing_types: ['Rent'],
      }),
    ];

    const handled = await processBuyerQualificationMessage(
      'Hi, not interested in renting. Are there commercial properties for sale?',
      { id: 'c1', phone: '919000000000', name: 'Sulekha' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1'
    );

    expect(handled).toBe(true);
    expect(recordLearnedFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: expect.arrayContaining([
          { field: 'pref_listing_types', value: ['Sale'] },
        ]),
      })
    );
    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('for purchase, not rent'),
      })
    );
    expect(rankPropertiesForContact).not.toHaveBeenCalled();
  });

  it('answers in a bot-heavy thread, which the old bot-message cap silenced', async () => {
    // Re-engagement threads carry dozens of bot messages by design;
    // counting them muted the reply exactly where a typed "budget is
    // 2 cr now" deserved a re-ranked answer.
    const handled = await run('owner-1');

    expect(handled).toBe(true);
    expect(recordLearnedFacts).toHaveBeenCalled();
    // Fully qualified + nothing fits → the playback card, not
    // "our team will call you".
    expect(sendRequirementReview).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        contact: expect.objectContaining({
          pref_budget_max: 20_000_000,
          pref_areas: ['Koramangala'],
        }),
      })
    );
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('stays quiet when a human agent owns the thread, but still files the update', async () => {
    queues.messages = [
      [
        { sender_type: 'customer' },
        { sender_type: 'agent' },
        { sender_type: 'bot' },
      ],
    ];

    const handled = await run('owner-1');

    expect(handled).toBe(false);
    // Listening is not capped: the requirement still lands on the
    // contact, and Radar shows the agent what it now matches.
    expect(recordLearnedFacts).toHaveBeenCalled();
    expect(generateMatchEventForContact).toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(sendRequirementReview).not.toHaveBeenCalled();
  });

  it('[INB-007] answers a fresh requirement after a later bot reply resumed the thread', async () => {
    queues.messages = [
      [
        {
          sender_type: 'customer',
          content_text: '60x40 site north or east facing at BTM 2nd stage',
        },
        { sender_type: 'bot', content_text: 'Here are two more options' },
        { sender_type: 'agent', content_text: 'Map: https://maps.example' },
      ],
    ];

    const handled = await processBuyerQualificationMessage(
      '60x40 site north or east facing at BTM 2nd stage',
      { id: 'c1', phone: '919000000000', name: 'Pramod' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1'
    );

    expect(handled).toBe(true);
    expect(recordLearnedFacts).toHaveBeenCalled();
    expect(sendRequirementReview).toHaveBeenCalled();
  });

  it('falls back to the plain no-match text without an owner user id', async () => {
    const handled = await run(undefined);

    expect(handled).toBe(true);
    expect(sendRequirementReview).not.toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalled();
  });

  it('sends matches when the updated brief fits live inventory', async () => {
    rankPropertiesForContact.mockResolvedValue([
      {
        property: {
          id: 'p1',
          title: 'Commercial Land in Koramangala',
          type: 'Commercial Land',
          price: 18_000_000,
          location: 'Koramangala',
          city: 'Bangalore',
        },
        score: 90,
        details: {},
      },
    ]);

    const handled = await run('owner-1');

    expect(handled).toBe(true);
    expect(sendRequirementReview).not.toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalled();
  });
});

describe('processBuyerQualificationMessage — a photo request', () => {
  // "Sir can I get images  images" right after a listing was shared.
  // The ladder claimed it and restarted intake with "what kind of
  // property are you looking for?"; the photos went out by hand.
  it('stands down so the media branch answers with the photos', async () => {
    const handled = await processBuyerQualificationMessage(
      'Sir can I get images  images',
      { id: 'c1', phone: '919000000000', name: 'Adi' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1'
    );

    expect(handled).toBe(false);
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(extractContactPreferences).not.toHaveBeenCalled();
  });

  it('still claims a message that carries a requirement alongside the ask', async () => {
    const handled = await processBuyerQualificationMessage(
      'Looking for a villa in Whitefield, send photos',
      { id: 'c1', phone: '919000000000', name: 'Adi' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1'
    );

    expect(handled).toBe(true);
    expect(recordLearnedFacts).toHaveBeenCalled();
  });
});

describe('processBuyerQualificationMessage — a lead still typing', () => {
  // "Land", then "Commercial or Semi commercial" three seconds later.
  // Two webhooks, two replies: "Noted — residential land/plot" (a guess
  // off one word, and the wrong one) and "Noted — commercial land".
  const runFirstOfTwo = () =>
    processBuyerQualificationMessage(
      'Land',
      { id: 'c1', phone: '919000000000', name: 'Aryan' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1',
      'wamid.first'
    );

  it('files the line but leaves the answering to the later message', async () => {
    queues.messages = [
      [{ sender_type: 'bot' }],
      { created_at: '2026-08-12T12:56:01.000Z' },
      { count: 1 },
    ];

    const handled = await runFirstOfTwo();

    expect(handled).toBe(true);
    // Filed and learned from — the second message's brief holds both
    // lines only because this one was still written down.
    expect(recordLearnedFacts).toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(sendRequirementReview).not.toHaveBeenCalled();
  });

  it("answers normally when it is the lead's last word", async () => {
    queues.messages = [
      [{ sender_type: 'bot' }],
      { created_at: '2026-08-12T12:56:01.000Z' },
      { count: 0 },
    ];

    await runFirstOfTwo();

    expect(sendRequirementReview).toHaveBeenCalled();
  });
});

describe('processBuyerQualificationMessage — more listings', () => {
  it('[INB-006] answers "More site" with the next unsent matches and files nothing', async () => {
    queues.contacts = [
      contactRow({
        requirements: 'Site in Vijaya Bank Layout 60x40',
        pref_property_types: ['Residential Plot'],
        pref_listing_types: ['Sale'],
        pref_areas: ['Vijaya Bank Layout'],
        pref_land_area_min_sqft: 2400,
        pref_land_area_max_sqft: 2400,
      }),
    ];
    queues.messages = [
      [
        { sender_type: 'customer', content_text: 'More site' },
        { sender_type: 'bot', content_text: 'Here are 3 that fit' },
      ],
      { count: 0 },
    ];
    rankPropertiesForContact.mockResolvedValue([
      {
        property: {
          id: 'p-1306',
          title: '2450 Sqft South facing residential plot in Vijayabank Layout',
          type: 'Residential Plot',
          price: 58_800_000,
          location: 'Vijaya Bank Layout',
          city: 'Bangalore',
        },
        score: 99,
        details: {},
      },
    ]);

    const handled = await processBuyerQualificationMessage(
      'More site',
      { id: 'c1', phone: '919000000000', name: 'Pramod' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1',
      'wamid.more'
    );

    expect(handled).toBe(true);
    expect(extractContactPreferences).not.toHaveBeenCalled();
    expect(recordLearnedFacts).not.toHaveBeenCalled();
    expect(rankPropertiesForContact).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'c1',
      expect.objectContaining({ excludeAlreadySent: true })
    );
    const sent = sendTextMessage.mock.calls[0][0].text as string;
    expect(sent).toContain("here's one more");
    expect(sent).toContain('2450 Sqft South facing');
    expect(sent).not.toContain('budget');
  });

  it('[INB-006] says so when nothing unsent is left', async () => {
    queues.contacts = [
      contactRow({
        pref_property_types: ['Residential Plot'],
        pref_listing_types: ['Sale'],
        pref_areas: ['Vijaya Bank Layout'],
      }),
    ];
    queues.messages = [
      [{ sender_type: 'customer', content_text: 'anything else?' }],
      { count: 0 },
    ];

    await processBuyerQualificationMessage(
      'anything else?',
      { id: 'c1', phone: '919000000000', name: 'Pramod' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1',
      'wamid.more'
    );

    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("That's everything that fits right now"),
      })
    );
    expect(extractContactPreferences).not.toHaveBeenCalled();
  });
});

describe('processBuyerQualificationMessage — the ladder remembers its questions', () => {
  it('[INB-006] does not re-ask the budget once it has scrolled past the last six messages', async () => {
    queues.contacts = [
      contactRow({
        requirements: 'Residential plot in Koramangala',
        pref_property_types: ['Residential Plot'],
        pref_listing_types: ['Sale'],
        pref_areas: ['Koramangala'],
      }),
    ];
    queues.messages = [
      [
        {
          sender_type: 'customer',
          content_text: 'need a 2400 sqft residential plot',
        },
        { sender_type: 'bot', content_text: 'Here are 3 that fit' },
        { sender_type: 'bot', content_text: 'Would you like alerts?' },
        { sender_type: 'customer', content_text: 'More site' },
        { sender_type: 'bot', content_text: 'Sure — here are 2 more' },
        { sender_type: 'customer', content_text: 'Purchase' },
        {
          sender_type: 'bot',
          content_text:
            "Certainly — I've understood you're looking for residential plot for purchase, not rent. What budget range are you working with?",
        },
      ],
      { count: 0 },
    ];
    extractContactPreferences.mockResolvedValue({
      ...EMPTY_PREFERENCES,
      property_types: ['Residential Plot'],
      listing_types: ['Sale'],
      areas: ['Koramangala'],
      land_area_min_sqft: 2400,
      land_area_max_sqft: 2400,
    });

    await processBuyerQualificationMessage(
      'need a 2400 sqft residential plot',
      { id: 'c1', phone: '919000000000', name: 'Pramod' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1'
    );

    expect(sendTextMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('What budget range'),
      })
    );
    expect(sendRequirementReview).toHaveBeenCalled();
  });
});

describe('processBuyerQualificationMessage — relative size feedback', () => {
  it('[INB-006] never stores a floor above the cap it just cleared', async () => {
    queues.contacts = [
      contactRow({
        requirements: 'Site in Vijaya Bank Layout 60x40',
        pref_property_types: ['Residential Plot'],
        pref_listing_types: ['Sale'],
        pref_areas: ['Vijaya Bank Layout'],
        pref_land_area_min_sqft: 2400,
        pref_land_area_max_sqft: 2400,
        last_inquired_property_id: 'p-shown',
      }),
    ];
    queues.messages = [
      [
        { sender_type: 'customer', content_text: 'bigger plot' },
        { sender_type: 'bot', content_text: 'Here are 3 that fit' },
      ],
    ];
    queues.properties = [
      { land_area: 2400, land_area_unit: 'sqft', area_sqft: null },
    ];
    extractContactPreferences.mockResolvedValue({
      ...EMPTY_PREFERENCES,
      property_types: ['Residential Plot'],
      listing_types: ['Sale'],
      areas: ['Vijaya Bank Layout'],
      land_area_min_sqft: 2400,
      land_area_max_sqft: 2400,
    });

    await processBuyerQualificationMessage(
      'bigger plot',
      { id: 'c1', phone: '919000000000', name: 'Pramod' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1'
    );

    expect(recordLearnedFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: expect.arrayContaining([
          { field: 'pref_land_area_min_sqft', value: 2824 },
          { field: 'pref_land_area_max_sqft', value: null },
        ]),
      })
    );
  });
});

describe('processBuyerQualificationMessage — one burst, two webhooks', () => {
  it('[INB-014] folds a newer line of the burst that was stored before this one ran', async () => {
    queues.contacts = [contactRow({ requirements: null })];
    queues.messages = [
      [
        {
          sender_type: 'customer',
          content_text: '1200 sqft',
          message_id: 'wamid.newer',
        },
        {
          sender_type: 'customer',
          content_text: '3000000 to 3500000',
          message_id: 'wamid.older',
        },
        { sender_type: 'bot', content_text: 'Hi Aryan' },
      ],
      { created_at: '2026-09-23T10:00:00.000Z' },
      { count: 1 },
    ];

    await processBuyerQualificationMessage(
      '3000000 to 3500000',
      { id: 'c1', phone: '919000000000', name: 'Aryan' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1',
      'wamid.older'
    );

    const filed = updates.find((u) => u.table === 'contacts');
    expect(filed?.payload.requirements).toContain('1200 sqft');
    expect(filed?.payload.requirements).toContain('3000000 to 3500000');
  });

  it("[INB-014] files the newer line's buy-or-rent when an older line of the burst runs last", async () => {
    queues.contacts = [contactRow({ requirements: null })];
    queues.messages = [
      [
        {
          sender_type: 'customer',
          content_text: '2 BHK flat for rent',
          message_id: 'wamid.newer',
        },
        {
          sender_type: 'customer',
          content_text: 'Buy 2 BHK flat',
          message_id: 'wamid.older',
        },
        { sender_type: 'bot', content_text: 'Hi Aryan' },
      ],
      { created_at: '2026-09-23T10:00:00.000Z' },
      { count: 1 },
    ];

    await processBuyerQualificationMessage(
      'Buy 2 BHK flat',
      { id: 'c1', phone: '919000000000', name: 'Aryan' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1',
      'wamid.older'
    );

    expect(recordLearnedFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: expect.arrayContaining([
          { field: 'pref_listing_types', value: ['Rent'] },
        ]),
      })
    );
  });

  it('[INB-006] [INB-014] never files a newer "More site" as part of the burst', async () => {
    queues.contacts = [contactRow({ requirements: null })];
    queues.messages = [
      [
        {
          sender_type: 'customer',
          content_text: 'More site',
          message_id: 'wamid.newer',
        },
        {
          sender_type: 'customer',
          content_text: '3000000 to 3500000',
          message_id: 'wamid.older',
        },
        { sender_type: 'bot', content_text: 'Hi Aryan' },
      ],
      { created_at: '2026-09-23T10:00:00.000Z' },
      { count: 1 },
    ];

    await processBuyerQualificationMessage(
      '3000000 to 3500000',
      { id: 'c1', phone: '919000000000', name: 'Aryan' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1',
      'wamid.older'
    );

    const filed = updates.find((u) => u.table === 'contacts');
    expect(filed?.payload.requirements).toBe('3000000 to 3500000');
  });

  it('[INB-014] stores the purchase a budget implies when the brief itself is unchanged', async () => {
    const line = 'budget 50 lakh';
    queues.contacts = [
      contactRow({
        requirements: line,
        pref_source_hash: preferenceSourceHash(
          buildPreferenceSourceText(line, [])
        ),
        pref_property_types: ['Residential Plot'],
        pref_areas: ['Koramangala'],
        pref_budget_max: 5_000_000,
        pref_listing_types: [],
      }),
    ];
    queues.messages = [[{ sender_type: 'customer', content_text: line }]];

    await processBuyerQualificationMessage(
      line,
      { id: 'c1', phone: '919000000000', name: 'Aryan' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1'
    );

    expect(extractContactPreferences).not.toHaveBeenCalled();
    expect(recordLearnedFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: [{ field: 'pref_listing_types', value: ['Sale'] }],
      })
    );
    expect(rankPropertiesForContact).toHaveBeenCalled();
    expect(recordLearnedFacts.mock.invocationCallOrder[0]).toBeLessThan(
      rankPropertiesForContact.mock.invocationCallOrder[0]
    );
  });
});

describe('processBuyerQualificationMessage — a buy-or-rent correction', () => {
  const prompt = {
    sender_type: 'bot',
    content_text: 'Are you looking to buy or to rent?',
  };
  const buy = {
    sender_type: 'customer',
    content_text: 'Buy',
    message_id: 'wamid.buy',
  };
  const rent = {
    sender_type: 'customer',
    content_text: 'Rent',
    message_id: 'wamid.rent',
  };
  const send = (line: string, id: string) =>
    processBuyerQualificationMessage(
      line,
      { id: 'c1', phone: '919000000000', name: 'Aryan' },
      { id: 'conv-1' },
      'acct-1',
      'token',
      'phone-id',
      'owner-1',
      id
    );
  const filedIntent = () =>
    recordLearnedFacts.mock.calls
      .map(
        ([arg]) =>
          (arg as { facts: { field: string; value: unknown }[] }).facts.find(
            (f) => f.field === 'pref_listing_types'
          )?.value
      )
      .filter(Boolean)
      .at(-1);
  const briefFor = (requirements: string) => ({
    requirements,
    pref_source_hash: preferenceSourceHash(
      buildPreferenceSourceText(requirements, [])
    ),
  });

  it('[INB-014] files Rent when "Rent" is processed after "Buy"', async () => {
    queues.contacts = [contactRow({ requirements: null })];
    queues.messages = [
      [buy, prompt],
      { id: 'm-buy', created_at: '2026-09-23T10:00:00.000Z' },
      { count: 0 },
    ];
    extractContactPreferences.mockResolvedValue(fullPrefs);
    await send('Buy', 'wamid.buy');
    expect(filedIntent()).toEqual(['Sale']);

    queues.whatsapp_config = [{ auto_qualify_leads: true }];
    queues.contacts = [
      contactRow({ ...briefFor('Buy'), pref_listing_types: ['Sale'] }),
    ];
    queues.messages = [
      [rent, buy, prompt],
      { id: 'm-rent', created_at: '2026-09-23T10:00:01.000Z' },
      { count: 0 },
    ];
    await send('Rent', 'wamid.rent');

    expect(filedIntent()).toEqual(['Rent']);
    expect(updates.at(-1)?.payload.requirements).toBe('Buy\nRent');
  });

  it('[INB-014] files Rent when "Buy" is processed after "Rent"', async () => {
    queues.contacts = [contactRow({ requirements: null })];
    queues.messages = [
      [rent, prompt],
      { id: 'm-rent', created_at: '2026-09-23T10:00:01.000Z' },
      { count: 0 },
    ];
    extractContactPreferences.mockResolvedValue(fullPrefs);
    await send('Rent', 'wamid.rent');
    expect(filedIntent()).toEqual(['Rent']);

    queues.whatsapp_config = [{ auto_qualify_leads: true }];
    queues.contacts = [
      contactRow({ ...briefFor('Rent'), pref_listing_types: ['Rent'] }),
    ];
    queues.messages = [
      [rent, buy, prompt],
      { id: 'm-buy', created_at: '2026-09-23T10:00:00.000Z' },
      { count: 1 },
    ];
    await send('Buy', 'wamid.buy');

    expect(filedIntent()).toEqual(['Rent']);
    expect(updates.at(-1)?.payload.requirements).toBe('Buy\nRent');
  });

  it('[INB-014] orders same-second lines by a stable key, and a tied sibling still supersedes', async () => {
    queues.contacts = [contactRow({ requirements: null })];
    queues.messages = [
      [buy, prompt],
      { id: 'm-buy', created_at: '2026-09-23T10:00:00.000Z' },
      { count: 1 },
    ];

    await send('Buy', 'wamid.buy');

    expect(
      filterCalls.filter((c) => c.table === 'messages' && c.method === 'order')
    ).toEqual([
      {
        table: 'messages',
        method: 'order',
        args: ['created_at', { ascending: false }],
      },
      {
        table: 'messages',
        method: 'order',
        args: ['id', { ascending: false }],
      },
    ]);
    expect(
      filterCalls.find((c) => c.table === 'messages' && c.method === 'or')
        ?.args[0]
    ).toBe(
      'created_at.gt."2026-09-23T10:00:00.000Z",and(created_at.eq."2026-09-23T10:00:00.000Z",id.gt.m-buy)'
    );
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('[INB-014] qualifies each conversation under its lease', async () => {
    queues.messages = [[{ sender_type: 'bot' }], { count: 0 }];
    await run('owner-1');
    expect(rpcCalls).toEqual([
      {
        fn: 'claim_conversation_qualification_lease',
        args: expect.objectContaining({
          p_account_id: 'acct-1',
          p_conversation_id: 'conv-1',
        }),
      },
    ]);
  });
});
