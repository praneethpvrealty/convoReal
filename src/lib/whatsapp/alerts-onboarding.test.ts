import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendPropertyTypePrompt = vi.fn();
const sendBudgetBandPrompt = vi.fn();
const sendPreferenceMatchFollowUp = vi.fn();
const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/whatsapp/property-type-prompt', () => ({
  sendPropertyTypePrompt: (...args: unknown[]) =>
    sendPropertyTypePrompt(...args),
}));

vi.mock('@/lib/whatsapp/budget-band', () => ({
  sendBudgetBandPrompt: (...args: unknown[]) => sendBudgetBandPrompt(...args),
}));

vi.mock('@/lib/whatsapp/preference-match-followup', () => ({
  sendPreferenceMatchFollowUp: (...args: unknown[]) =>
    sendPreferenceMatchFollowUp(...args),
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

const { sendAlertsOnboarding } = await import('./alerts-onboarding');

/**
 * START ALERTS opens a free-form window at the lead's moment of
 * highest intent; consent alone used to be the whole transaction.
 * These pin the ladder that now runs in it — the first missing rung
 * as a tap, matches when the profile is complete — through the REAL
 * qualifier, so "no fixed budget" counting as answered is proven
 * here, not assumed.
 */

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

const args = (row: Record<string, unknown> | null) => ({
  db: dbWithContact(row),
  accountId: 'acct-1',
  userId: 'user-1',
  contactId: 'c1',
  conversationId: 'conv-1',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendAlertsOnboarding', () => {
  it('asks for the type first when the profile is empty', async () => {
    await sendAlertsOnboarding(args({ id: 'c1' }));

    expect(sendPropertyTypePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', includeFormRow: true })
    );
    expect(sendBudgetBandPrompt).not.toHaveBeenCalled();
  });

  it('moves to budget bands once the type is known', async () => {
    await sendAlertsOnboarding(
      args({ id: 'c1', pref_property_types: ['Residential Land/ Plot'] })
    );

    expect(sendBudgetBandPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', includeFormRow: true })
    );
    expect(sendPropertyTypePrompt).not.toHaveBeenCalled();
  });

  it('treats "no fixed budget" as answered instead of asking again', async () => {
    // The budget rung is where a bb_none tap loops back in; asking for
    // a budget the lead just said they don't have would never converge.
    await sendAlertsOnboarding(
      args({
        id: 'c1',
        pref_property_types: ['Residential Land/ Plot'],
        no_budget: true,
      })
    );

    expect(sendBudgetBandPrompt).not.toHaveBeenCalled();
    // Location is still missing, so the ladder asks for it as text.
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('which area') })
    );
  });

  it('counts agent-entered areas_of_interest as a location answer', async () => {
    await sendAlertsOnboarding(
      args({
        id: 'c1',
        pref_property_types: ['Residential Land/ Plot'],
        no_budget: true,
        areas_of_interest: ['Koramangala'],
      })
    );

    expect(sendPreferenceMatchFollowUp).toHaveBeenCalled();
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('answers a complete profile with the shortlist, not questions', async () => {
    await sendAlertsOnboarding(
      args({
        id: 'c1',
        pref_property_types: ['Commercial Land'],
        pref_budget_max: 67000000,
        pref_areas: ['Koramangala'],
      })
    );

    expect(sendPreferenceMatchFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1' })
    );
    expect(sendPropertyTypePrompt).not.toHaveBeenCalled();
    expect(sendBudgetBandPrompt).not.toHaveBeenCalled();
  });

  it('acknowledges only the changed field before asking the next question', async () => {
    await sendAlertsOnboarding({
      ...args({
        id: 'c1',
        pref_property_types: ['Commercial Land'],
        pref_budget_min: 50_000_000,
      }),
      acknowledgement:
        "Got it — I've changed your budget to above ₹5 Cr and kept the rest of your search unchanged.",
    });

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Which areas should I focus on?'),
      })
    );
  });

  it('uses the concise no-match outcome after a one-field change', async () => {
    const acknowledgement =
      "Got it — I've changed your budget to above ₹5 Cr and kept the rest of your search unchanged.";
    await sendAlertsOnboarding({
      ...args({
        id: 'c1',
        pref_property_types: ['Commercial Land'],
        pref_budget_min: 50_000_000,
        pref_areas: ['HSR Layout'],
      }),
      acknowledgement,
    });

    expect(sendPreferenceMatchFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgement,
        reviewNoMatch: false,
      })
    );
  });

  it('stands down without a contact row', async () => {
    await sendAlertsOnboarding(args(null));
    expect(sendPropertyTypePrompt).not.toHaveBeenCalled();
    expect(sendPreferenceMatchFollowUp).not.toHaveBeenCalled();
  });

  it('never throws — consent is already recorded', async () => {
    sendPreferenceMatchFollowUp.mockRejectedValue(new Error('rank down'));
    await expect(
      sendAlertsOnboarding(
        args({
          id: 'c1',
          pref_property_types: ['Commercial Land'],
          pref_budget_max: 1,
          pref_areas: ['HSR'],
        })
      )
    ).resolves.toBeUndefined();
  });
});
