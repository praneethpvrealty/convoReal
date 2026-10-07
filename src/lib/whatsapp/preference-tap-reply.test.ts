import { describe, it, expect, vi, beforeEach } from 'vitest';

const rankPropertiesForContact = vi.fn();
const generateMatchEventForContact = vi.fn();
const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/radar/engine', () => ({
  rankPropertiesForContact: (...args: unknown[]) =>
    rankPropertiesForContact(...args),
  generateMatchEventForContact: (...args: unknown[]) =>
    generateMatchEventForContact(...args),
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

const sendListingFeedbackPrompt = vi.fn();

vi.mock('@/lib/whatsapp/listing-feedback', () => ({
  sendListingFeedbackPrompt: (...args: unknown[]) =>
    sendListingFeedbackPrompt(...args),
}));

const sendBudgetBandPrompt = vi.fn();
const sendListingIntentPrompt = vi.fn();
const applyDefaultBuyingIntent = vi.fn();

vi.mock('@/lib/whatsapp/budget-band', () => ({
  sendBudgetBandPrompt: (...args: unknown[]) => sendBudgetBandPrompt(...args),
}));

vi.mock('@/lib/whatsapp/listing-intent-prompt', () => ({
  sendListingIntentPrompt: (...args: unknown[]) =>
    sendListingIntentPrompt(...args),
  applyDefaultBuyingIntent: (...args: unknown[]) =>
    applyDefaultBuyingIntent(...args),
}));

const areaNearMissLine = vi.fn();

vi.mock('@/lib/buyer/area-near-misses', () => ({
  areaNearMissLine: (...args: unknown[]) => areaNearMissLine(...args),
}));

const { sendPreferenceTapReply, buildPreferenceTapReply, isReEngagedLead } =
  await import('./preference-tap-reply');

/**
 * A lead who taps "Update my preferences" has answered a re-engagement
 * template — the first sign of life the campaign gets. Batches 1–4: 20
 * tapped or replied, 7 forms sent, 1 completed. These pin that a tap is
 * answered with inventory and a question answerable in chat, with the
 * form demoted to a follow-on message.
 */

const LISTING =
  '*1. 1500 Sq.Ft. Residential Plot in Koramangala*\n1500 sq.ft\n📍 Koramangala\nhttps://x/?property_id=p1&v=c1';

describe('buildPreferenceTapReply', () => {
  it('congratulates, anchors the enquiry, shows listings, asks in chat', () => {
    const text = buildPreferenceTapReply({
      contactName: 'Sanjuali Rao',
      enquiry: 'Commercial Land in Kudremukh Colony, Koramangala',
      listings: [LISTING, LISTING.replace('*1.', '*2.')],
      question:
        "One thing — what budget are you working with? I'll narrow these down.",
    });

    expect(text).toContain('Thanks for getting back to us, Sanjuali');
    expect(text).toContain(
      'your interest in *Commercial Land in Kudremukh Colony, Koramangala*'
    );
    expect(text).toContain('here are 2 live options');
    expect(text).toContain('*1. 1500 Sq.Ft. Residential Plot in Koramangala*');
    expect(text).toContain(
      'keep matching new listings against your requirement'
    );
    expect(text).toContain('what budget are you working with?');
    // The form message follows this one and carries the tap CTA; this
    // text saying "tap below" would point at nothing.
    expect(text.toLowerCase()).not.toContain('tap below');
  });

  it('does not greet a lead by their portal placeholder name', () => {
    const text = buildPreferenceTapReply({
      contactName: 'MagicBricks Lead',
      enquiry: null,
      listings: [],
      question: null,
    });
    expect(text).toContain('Thanks for getting back to us, there');
    expect(text).not.toContain('MagicBricks');
  });

  it('[CNV-002] welcomes a returning lead back, never a new one', () => {
    const base = {
      contactName: 'Shirish',
      enquiry: null,
      listings: [],
      question: null,
    };
    expect(buildPreferenceTapReply({ ...base, reEngaged: true })).toContain(
      "Great to hear from you, Shirish 👍 You're back on our radar."
    );
    const fresh = buildPreferenceTapReply({ ...base, reEngaged: false });
    expect(fresh).toContain('Thanks for getting back to us, Shirish 👍');
    expect(fresh).not.toContain('radar');
    expect(fresh).not.toMatch(/intelligent matching engine/i);
  });

  it('[CNV-002] names the near-miss stock and the showcase link before the question when nothing fits', () => {
    const text = buildPreferenceTapReply({
      contactName: 'Shirish',
      enquiry: 'Commercial Land in Dollars Colony',
      listings: [],
      question:
        "One thing — what budget are you working with? I'll narrow these down.",
      nearMiss:
        '📍 We do have 3 listings in JP Nagar, at ₹9.6 Cr–₹21.6 Cr. Take a look: https://x/?ids=a,b,c',
      showcaseUrl: 'https://x/?v=c1',
    });
    expect(text).toBe(
      [
        'Thanks for getting back to us, Shirish 👍',
        '',
        "Nothing live right now fits your interest in *Commercial Land in Dollars Colony* exactly, but I'll keep watching and message you the moment the right property comes in.",
        '',
        '📍 We do have 3 listings in JP Nagar, at ₹9.6 Cr–₹21.6 Cr. Take a look: https://x/?ids=a,b,c',
        '',
        'Browse every live listing any time: https://x/?v=c1',
        '',
        "One thing — what budget are you working with? I'll narrow these down.",
      ].join('\n')
    );
  });

  it('[CNV-002] keeps the showcase link on the listings reply too, ahead of the question', () => {
    const text = buildPreferenceTapReply({
      contactName: 'Shirish',
      enquiry: null,
      listings: [LISTING],
      question: null,
      showcaseUrl: 'https://x/?v=c1',
    });
    const link = text.indexOf(
      'Browse every live listing any time: https://x/?v=c1'
    );
    expect(link).toBeGreaterThan(text.indexOf(LISTING));
    expect(link).toBeLessThan(text.indexOf('Want photos or a site visit'));
  });
});

describe('isReEngagedLead', () => {
  it('[CNV-002] treats a lead younger than a week as answering their own enquiry', () => {
    const now = Date.parse('2026-10-07T10:15:00Z');
    expect(isReEngagedLead('2026-10-07T10:14:47Z', now)).toBe(false);
    expect(isReEngagedLead('2026-09-29T10:14:47Z', now)).toBe(true);
    expect(isReEngagedLead(null, now)).toBe(false);
  });

  it('keeps the engine promise when nothing fits, and still asks', () => {
    // 2 of the first 7 tappers have zero strict-area matches; for them
    // this branch is the whole reply, so it must carry the promise and
    // the question rather than a dead end.
    const text = buildPreferenceTapReply({
      contactName: 'Somesh',
      enquiry: '5 BHK Residential House in Bangalore',
      listings: [],
      question:
        "One thing — what budget are you working with? I'll narrow these down.",
    });

    expect(text).toContain('Nothing live right now fits');
    expect(text).toContain('*5 BHK Residential House in Bangalore*');
    expect(text).toContain('the moment the right property comes in');
    expect(text).toContain('what budget are you working with?');
    expect(text).not.toMatch(/intelligent matching engine/i);
  });

  it('leaves the thread open when fully qualified with no match', () => {
    const text = buildPreferenceTapReply({
      contactName: 'Somesh',
      enquiry: null,
      listings: [],
      question: null,
    });
    expect(text).toContain('just reply here');
  });
});

function dbWithContact(row: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row }),
          }),
        }),
      }),
    }),
  } as never;
}

const contactRow = {
  id: 'c1',
  name: 'Sanjuali',
  pref_property_types: ['Commercial Land'],
  pref_listing_types: ['Sale'],
  pref_areas: ['Koramangala'],
  contact_notes: [
    {
      note_text:
        'This user is looking for Commercial Land for Sale in Koramangala, Bangalore and has viewed your contact details.',
    },
  ],
};

const args = (row: Record<string, unknown> | null = contactRow) => ({
  db: dbWithContact(row),
  accountId: 'acct-1',
  userId: 'user-1',
  contactId: 'c1',
  conversationId: 'conv-1',
});

const aMatch = {
  property: { id: 'p1', title: 'Plot in Koramangala' },
  score: 85,
  details: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  areaNearMissLine.mockResolvedValue(null);
  generateMatchEventForContact.mockResolvedValue(undefined);
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  sendListingFeedbackPrompt.mockResolvedValue(true);
  applyDefaultBuyingIntent.mockResolvedValue(true);
});

describe('sendPreferenceTapReply', () => {
  it('ranks with strictArea, since this goes straight to the buyer', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceTapReply(args());

    expect(rankPropertiesForContact).toHaveBeenCalledTimes(1);
    expect(rankPropertiesForContact).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'c1',
      { strictArea: true, excludeAlreadySent: true }
    );
  });

  it('[CNV-002] widens to the ordinary radius before saying nothing fits', async () => {
    rankPropertiesForContact
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([aMatch]);

    const result = await sendPreferenceTapReply(args());

    expect(rankPropertiesForContact).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'acct-1',
      'c1',
      { strictArea: false, excludeAlreadySent: true }
    );
    expect(result.matchCount).toBe(1);
    expect(areaNearMissLine).not.toHaveBeenCalled();
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain('Plot in Koramangala');
  });

  it('[CNV-002] names the near-miss stock and the showcase link when both searches come back empty', async () => {
    rankPropertiesForContact.mockResolvedValue([]);
    areaNearMissLine.mockResolvedValue(
      '📍 We do have 2 listings in Koramangala, at ₹9 Cr–₹12 Cr. Take a look: https://x/?ids=a,b'
    );
    sendBudgetBandPrompt.mockResolvedValue(true);

    await sendPreferenceTapReply(args());

    expect(rankPropertiesForContact).toHaveBeenCalledTimes(2);
    expect(areaNearMissLine).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'c1',
        brief: expect.objectContaining({
          areas: ['Koramangala'],
          listingTypes: ['Sale'],
        }),
      })
    );
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain('📍 We do have 2 listings in Koramangala');
    expect(text).toMatch(/Browse every live listing any time: http\S+v=c1/);
    expect(text).toContain('Thanks for getting back to us, Sanjuali');
  });

  it('[CNV-002] greets a lead older than a week as returning', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceTapReply(
      args({ ...contactRow, created_at: '2026-01-01T00:00:00Z' })
    );

    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain("You're back on our radar");
  });

  it('sends listings anchored on the enquiry, and asks for the budget', async () => {
    // Type and area are known from the enquiry; budget is the missing
    // rung, and it must be answerable by replying — the qualification
    // ladder treats a bare answer after a bot question as an answer.
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    const result = await sendPreferenceTapReply(args());

    expect(result).toEqual({
      matchCount: 1,
      replySent: true,
      formOffered: true,
    });
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain(
      'Commercial Land for Sale in Koramangala, Bangalore'
    );
    expect(text).toContain('what budget are you working with?');
  });

  it('raises a Radar event so the agent sees what the lead was shown', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);
    await sendPreferenceTapReply(args());
    expect(generateMatchEventForContact).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'c1'
    );
  });

  it('follows the listings with the one-tap feedback list, form row included', async () => {
    // The list's "Update preferences" row replaces the separate form
    // message, keeping the turn at two bubbles.
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceTapReply(args());

    expect(sendListingFeedbackPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ matches: [aMatch], includeFormRow: true })
    );
  });

  it('skips the feedback list when nothing was shown', async () => {
    rankPropertiesForContact.mockResolvedValue([]);
    await sendPreferenceTapReply(args());
    expect(sendListingFeedbackPrompt).not.toHaveBeenCalled();
  });

  it('raises no Radar event when there was nothing to show', async () => {
    rankPropertiesForContact.mockResolvedValue([]);
    await sendPreferenceTapReply(args());
    expect(generateMatchEventForContact).not.toHaveBeenCalled();
  });

  it('never throws — the caller still owes the lead the form', async () => {
    rankPropertiesForContact.mockRejectedValue(new Error('inventory down'));

    await expect(sendPreferenceTapReply(args())).resolves.toEqual({
      matchCount: 0,
      replySent: false,
      formOffered: false,
    });
  });

  it('turns a no-match budget question into the tappable band list', async () => {
    // Budget is the missing rung for this fixture; with no listings to
    // judge, the band list takes the interactive slot and carries the
    // form row, so the closing line points down instead of asking for
    // a typed answer.
    rankPropertiesForContact.mockResolvedValue([]);
    sendBudgetBandPrompt.mockResolvedValue(true);

    const result = await sendPreferenceTapReply(args());

    expect(result.formOffered).toBe(true);
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain('pick your budget range below');
    expect(text).not.toContain('what budget are you working with?');
    expect(sendBudgetBandPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', includeFormRow: true })
    );
  });

  it('[INB-002] defaults missing intent to buying and offers renting as the exception', async () => {
    rankPropertiesForContact.mockResolvedValue([]);
    sendBudgetBandPrompt.mockResolvedValue(true);

    const result = await sendPreferenceTapReply(
      args({ ...contactRow, pref_listing_types: [] })
    );

    expect(result.formOffered).toBe(true);
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain("assume you're buying");
    expect(sendBudgetBandPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        includeFormRow: true,
        includeRentSwitch: true,
      })
    );
    expect(sendListingIntentPrompt).not.toHaveBeenCalled();
  });

  it('states the buying default when matching listings use the interactive slot', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceTapReply(
      args({ ...contactRow, pref_listing_types: [] })
    );

    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain("assume you're buying");
    expect(text).toContain('reply “renting” if needed');
  });

  it('keeps the typed budget question when listings occupy the interactive slot', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceTapReply(args());

    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain('what budget are you working with?');
    expect(sendBudgetBandPrompt).not.toHaveBeenCalled();
  });

  it('stands down without a contact row rather than sending a hole', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    const result = await sendPreferenceTapReply(args(null));

    expect(result.replySent).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });
});
