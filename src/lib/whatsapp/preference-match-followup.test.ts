import { describe, it, expect, vi, beforeEach } from 'vitest';

const rankPropertiesForContact = vi.fn();
const generateMatchEventForContact = vi.fn();
const sendWhatsAppMessageAndPersist = vi.fn();
const buildMatchesReply = vi.fn();

vi.mock('@/lib/radar/engine', () => ({
  rankPropertiesForContact: (...args: unknown[]) =>
    rankPropertiesForContact(...args),
  generateMatchEventForContact: (...args: unknown[]) =>
    generateMatchEventForContact(...args),
}));

vi.mock('@/lib/ai/buyer-qualification', () => ({
  buildMatchesReply: (...args: unknown[]) => buildMatchesReply(...args),
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

const sendRequirementReview = vi.fn();

vi.mock('@/lib/whatsapp/requirement-review', () => ({
  sendRequirementReview: (...args: unknown[]) => sendRequirementReview(...args),
}));

const { sendPreferenceMatchFollowUp, buildNoLiveMatchReply } =
  await import('./preference-match-followup');

/** Minimal stand-in for the one contact-name lookup the module makes. */
function dbWithContactName(name: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: name === null ? null : { name },
            }),
          }),
        }),
      }),
    }),
  } as never;
}

const args = (name: string | null = 'Asha Kumar') => ({
  db: dbWithContactName(name),
  accountId: 'acct-1',
  userId: 'user-1',
  contactId: 'contact-1',
  conversationId: 'conv-1',
});

const aMatch = { property: { id: 'prop-1' }, score: 82, details: {} };

beforeEach(() => {
  vi.clearAllMocks();
  generateMatchEventForContact.mockResolvedValue(undefined);
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  buildMatchesReply.mockReturnValue('here are 3 that fit');
});

describe('sendPreferenceMatchFollowUp', () => {
  it('replies with the matches the buyer just qualified for', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch, aMatch, aMatch]);

    const result = await sendPreferenceMatchFollowUp(args());

    expect(result).toEqual({ matchCount: 3, replySent: true });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'here are 3 that fit',
        kind: 'text',
        senderType: 'bot',
        contactId: 'contact-1',
        conversationId: 'conv-1',
      })
    );
  });

  it('ranks with strictArea, since this goes straight to the buyer', async () => {
    // The default 20km radius is for Radar, where an agent filters
    // before sending. Nobody filters this one.
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceMatchFollowUp(args());

    expect(rankPropertiesForContact).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'contact-1',
      { strictArea: true }
    );
  });

  it('raises a Radar event so the agent sees what the lead was shown', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceMatchFollowUp(args());

    expect(generateMatchEventForContact).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'contact-1'
    );
  });

  it('answers a no-match with the requirement playback card', async () => {
    // "Nothing fits that yet" is a dead end unless the lead can see
    // what *that* is and correct it.
    rankPropertiesForContact.mockResolvedValue([]);
    sendRequirementReview.mockResolvedValue(true);

    const result = await sendPreferenceMatchFollowUp(args());

    expect(result).toEqual({ matchCount: 0, replySent: true });
    expect(sendRequirementReview).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact-1' })
    );
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('still answers in plain text when there is nothing on file to review', async () => {
    // The confirmation summary already promised a match; silence would
    // read as the form having gone nowhere.
    rankPropertiesForContact.mockResolvedValue([]);
    sendRequirementReview.mockResolvedValue(false);

    const result = await sendPreferenceMatchFollowUp(args());

    expect(result.matchCount).toBe(0);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: buildNoLiveMatchReply('Asha Kumar') })
    );
  });

  it('raises no Radar event when there was nothing to show', async () => {
    rankPropertiesForContact.mockResolvedValue([]);
    await sendPreferenceMatchFollowUp(args());
    expect(generateMatchEventForContact).not.toHaveBeenCalled();
  });

  it('never throws — the preferences are already saved by this point', async () => {
    rankPropertiesForContact.mockRejectedValue(new Error('inventory down'));

    await expect(sendPreferenceMatchFollowUp(args())).resolves.toEqual({
      matchCount: 0,
      replySent: false,
    });
  });

  it('reports a send that failed rather than claiming success', async () => {
    rankPropertiesForContact.mockResolvedValue([aMatch]);
    sendWhatsAppMessageAndPersist.mockResolvedValue({
      success: false,
      error: 'window closed',
    });

    const result = await sendPreferenceMatchFollowUp(args());

    expect(result).toEqual({ matchCount: 1, replySent: false });
  });

  it('goes through the dispatcher, which enforces the 24h window', async () => {
    // Sending via meta-api directly would skip the 131047 guard.
    rankPropertiesForContact.mockResolvedValue([aMatch]);
    await sendPreferenceMatchFollowUp(args());
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
  });

  it('follows the listings with the one-tap feedback list, minus the form row', async () => {
    // This lead just completed the form; re-offering it would be noise.
    rankPropertiesForContact.mockResolvedValue([aMatch]);

    await sendPreferenceMatchFollowUp(args());

    expect(sendListingFeedbackPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ matches: [aMatch] })
    );
    const call = sendListingFeedbackPrompt.mock.calls[0][0] as {
      includeFormRow?: boolean;
    };
    expect(call.includeFormRow).toBeUndefined();
  });

  it('skips the feedback list when nothing was shown', async () => {
    rankPropertiesForContact.mockResolvedValue([]);
    await sendPreferenceMatchFollowUp(args());
    expect(sendListingFeedbackPrompt).not.toHaveBeenCalled();
  });
});

describe('buildNoLiveMatchReply', () => {
  it('greets by first name', () => {
    expect(buildNoLiveMatchReply('Asha Kumar')).toContain('Thanks Asha —');
  });

  it('does not greet a lead by their portal placeholder name', () => {
    // Imported leads are filed as "Housing Lead" / "MagicBricks Lead".
    const reply = buildNoLiveMatchReply('Housing Lead');
    expect(reply).toContain('Thanks there —');
    expect(reply).not.toContain('Housing');
  });

  it('keeps the thread open instead of closing it', () => {
    const reply = buildNoLiveMatchReply('Asha');
    expect(reply).toContain('saved');
    expect(reply).toContain('reply here');
  });
});
