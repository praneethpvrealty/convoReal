import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendRequirementReview = vi.fn();
vi.mock('@/lib/whatsapp/requirement-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./requirement-review')>()),
  sendRequirementReview: (...args: unknown[]) => sendRequirementReview(...args),
}));

const {
  buildRegretBriefOpening,
  hasRequirementOnFile,
  REGRET_BRIEF_CLOSING,
  sendRequirementConfirmAfterRegret,
} = await import('./unavailable-brief-followup');

const ramanathan = {
  id: 'c-1',
  name: 'Ramanathan',
  pref_property_types: ['site', 'residential plot', 'villa'],
  pref_areas: ['Vijaya Bank Layout', 'Bannerghatta Road', 'Bangalore'],
  pref_budget_max: 100_000_000,
  pref_land_area_min_sqft: 2400,
  pref_land_area_max_sqft: 2400,
};

const recentCards: { content_text: string }[] = [];

function dbWith(
  contact: Record<string, unknown> | null,
  agentWroteRecently = false
) {
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        neq: () => builder,
        gte: () => builder,
        limit: () => builder,
        like: (column: string, pattern: string) => {
          filters[column] = pattern;
          return builder;
        },
        maybeSingle: async () => ({
          data:
            table === 'contacts'
              ? contact
              : filters.sender_type === 'agent'
                ? agentWroteRecently
                  ? { id: 'agent-message' }
                  : null
                : (recentCards.find((row) =>
                    row.content_text.includes(
                      String(filters.content_text).replace(/^%|%$/g, '')
                    )
                  ) ?? null),
          error: null,
        }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  sendRequirementReview.mockReset();
  sendRequirementReview.mockResolvedValue(true);
  recentCards.length = 0;
});

describe('[PRP-050] the brief played back after a regret', () => {
  it('knows whether the contact has a requirement worth playing back', async () => {
    expect(await hasRequirementOnFile(dbWith(ramanathan), 'acc-1', 'c-1')).toBe(
      true
    );
    expect(
      await hasRequirementOnFile(
        dbWith({ id: 'c-2', name: 'New' }),
        'acc-1',
        'c-2'
      )
    ).toBe(false);
    expect(await hasRequirementOnFile(dbWith(null), 'acc-1', 'c-3')).toBe(
      false
    );
  });

  it('does not count a half-qualified brief — a type with no budget or area still goes through the ladder', async () => {
    expect(
      await hasRequirementOnFile(
        dbWith({ id: 'c-4', name: 'Partial', pref_property_types: ['villa'] }),
        'acc-1',
        'c-4'
      )
    ).toBe(false);
    expect(
      await hasRequirementOnFile(
        dbWith({
          id: 'c-5',
          name: 'No area',
          pref_property_types: ['villa'],
          pref_budget_max: 20_000_000,
        }),
        'acc-1',
        'c-5'
      )
    ).toBe(false);
  });

  it('plays the brief back with a confirm-to-get-options closing, in the regret voice', async () => {
    const sent = await sendRequirementConfirmAfterRegret({
      db: dbWith(ramanathan),
      accountId: 'acc-1',
      userId: 'owner-1',
      contactId: 'c-1',
      conversationId: 'conv-1',
    });
    expect(sent).toBe(true);
    expect(sendRequirementReview).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'owner-1',
        contactId: 'c-1',
        conversationId: 'conv-1',
        contact: expect.objectContaining({ id: 'c-1' }),
        opening: "Here's the requirement I have on file for you, Ramanathan:",
        closing: REGRET_BRIEF_CLOSING,
      })
    );
    expect(REGRET_BRIEF_CLOSING).toMatch(/All correct/);
    expect(buildRegretBriefOpening('99acres Lead')).toBe(
      "Here's the requirement I have on file for you:"
    );
  });

  it('plays the brief back once per thread, however many sold listings one message named', async () => {
    recentCards.push({
      content_text: `Here's the requirement I have on file for you, Ramanathan:\n\n📌 brief\n\n${REGRET_BRIEF_CLOSING}`,
    });
    expect(
      await sendRequirementConfirmAfterRegret({
        db: dbWith(ramanathan),
        accountId: 'acc-1',
        userId: 'owner-1',
        contactId: 'c-1',
        conversationId: 'conv-1',
      })
    ).toBe(false);
    expect(sendRequirementReview).not.toHaveBeenCalled();
  });

  it('sends nothing when there is nothing on file', async () => {
    expect(
      await sendRequirementConfirmAfterRegret({
        db: dbWith({ id: 'c-2', name: 'New' }),
        accountId: 'acc-1',
        userId: 'owner-1',
        contactId: 'c-2',
        conversationId: 'conv-1',
      })
    ).toBe(false);
    expect(sendRequirementReview).not.toHaveBeenCalled();
  });
});

describe('[INB-046] the regret playback waits for an agent handling the thread', () => {
  it('sends no card when an agent wrote in the last few minutes', async () => {
    expect(
      await sendRequirementConfirmAfterRegret({
        db: dbWith(ramanathan, true),
        accountId: 'acc-1',
        userId: 'owner-1',
        contactId: 'c-1',
        conversationId: 'conv-1',
      })
    ).toBe(false);
    expect(sendRequirementReview).not.toHaveBeenCalled();
  });
});
