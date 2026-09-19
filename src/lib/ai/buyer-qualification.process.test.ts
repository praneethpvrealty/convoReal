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

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gt', 'order', 'limit', 'update']) {
        chain[m] = () => chain;
      }
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
const { EMPTY_PREFERENCES } = await import('./preference-extraction');

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
