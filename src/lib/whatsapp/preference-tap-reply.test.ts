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

const { sendPreferenceTapReply, buildPreferenceTapReply } =
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

    expect(text).toContain('Great to hear from you, Sanjuali');
    expect(text).toContain(
      'your interest in *Commercial Land in Kudremukh Colony, Koramangala*'
    );
    expect(text).toContain('here are 2 live options');
    expect(text).toContain('*1. 1500 Sq.Ft. Residential Plot in Koramangala*');
    expect(text).toContain('right properties at the right time');
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
    expect(text).toContain('Great to hear from you, there');
    expect(text).not.toContain('MagicBricks');
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
  generateMatchEventForContact.mockResolvedValue(undefined);
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
});

describe('sendPreferenceTapReply', () => {
  it('ranks with strictArea, since this goes straight to the buyer', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceTapReply(args());

    expect(rankPropertiesForContact).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'c1',
      { strictArea: true }
    );
  });

  it('sends listings anchored on the enquiry, and asks for the budget', async () => {
    // Type and area are known from the enquiry; budget is the missing
    // rung, and it must be answerable by replying — the qualification
    // ladder treats a bare answer after a bot question as an answer.
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    const result = await sendPreferenceTapReply(args());

    expect(result).toEqual({ matchCount: 1, replySent: true });
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
    });
  });

  it('stands down without a contact row rather than sending a hole', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    const result = await sendPreferenceTapReply(args(null));

    expect(result.replySent).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });
});
