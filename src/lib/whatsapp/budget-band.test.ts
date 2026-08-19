import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

const {
  buildBudgetBandSections,
  budgetBandAcknowledgement,
  sendBudgetBandPrompt,
  handleBudgetBandReply,
  isRentOnlyIntent,
} = await import('./budget-band');

/**
 * Budget is the emptiest field in the funnel, and the free-text
 * question is why. These pin the band capture: a tap writes a real
 * min/max range the matcher compares against, "no fixed budget" is a
 * recordable answer rather than silence, and rent-intent leads see
 * monthly bands instead of crore price tags.
 */

function stubDb(contactRow: unknown = null) {
  const updates: { table: string; patch: unknown }[] = [];
  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in']) {
        chain[m] = () => chain;
      }
      chain.update = (patch: unknown) => {
        updates.push({ table, patch });
        return chain;
      };
      chain.maybeSingle = async () => ({ data: contactRow });
      (chain as { then?: unknown }).then = (r: (v: unknown) => unknown) =>
        Promise.resolve(r({ data: null }));
      return chain;
    },
  } as never;
  return { db, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
});

describe('buildBudgetBandSections', () => {
  it('offers sale bands, a no-budget row, and stays within list limits', () => {
    const [section] = buildBudgetBandSections({});
    expect(section.rows.some((r) => r.id === 'bb_none')).toBe(true);
    expect(section.rows.length).toBeLessThanOrEqual(10);
    for (const row of section.rows) {
      // Meta caps row titles at 24 chars — a longer one fails the send.
      expect(row.title.length).toBeLessThanOrEqual(24);
    }
  });

  it('switches to monthly bands for rent-only intent', () => {
    const [section] = buildBudgetBandSections({ rentOnly: true });
    expect(section.rows.some((r) => r.id.startsWith('bb_r'))).toBe(true);
    expect(section.rows.some((r) => r.id.startsWith('bb_s'))).toBe(false);
  });

  it('reuses the lfb_form id so the existing form route serves this list too', () => {
    const [section] = buildBudgetBandSections({ includeFormRow: true });
    expect(section.rows.at(-1)?.id).toBe('lfb_form');
  });
});

describe('isRentOnlyIntent', () => {
  it('is true only when Rent is stated without Sale', () => {
    expect(isRentOnlyIntent(['Rent'])).toBe(true);
    expect(isRentOnlyIntent(['Rent', 'Sale'])).toBe(false);
    expect(isRentOnlyIntent(['Sale'])).toBe(false);
    expect(isRentOnlyIntent(null)).toBe(false);
  });
});

describe('handleBudgetBandReply', () => {
  it('writes the band as a real range the matcher compares against', async () => {
    const { db, updates } = stubDb();

    const handled = await handleBudgetBandReply({
      db,
      accountId: 'acct-1',
      contactId: 'c1',
      replyId: 'bb_s1',
    });

    expect(handled).toBe(true);
    expect(updates[0]).toEqual({
      table: 'contacts',
      patch: {
        no_budget: false,
        pref_budget_min: 5_000_000,
        pref_budget_max: 10_000_000,
      },
    });
  });

  it('records "no fixed budget" as an answer, clearing any stale range', async () => {
    const { db, updates } = stubDb();

    await handleBudgetBandReply({
      db,
      accountId: 'acct-1',
      contactId: 'c1',
      replyId: 'bb_none',
    });

    expect(updates[0].patch).toEqual({
      no_budget: true,
      pref_budget_min: null,
      pref_budget_max: null,
    });
  });

  it('ignores ids it does not own, so other handlers still run', async () => {
    const { db, updates } = stubDb();
    const handled = await handleBudgetBandReply({
      db,
      accountId: 'acct-1',
      contactId: 'c1',
      replyId: 'bb_forged',
    });
    expect(handled).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe('budgetBandAcknowledgement', () => {
  it('confirms only the field the buyer changed', () => {
    expect(budgetBandAcknowledgement('bb_s4')).toBe(
      "Got it — I've changed your budget to above ₹5 Cr and kept the rest of your search unchanged."
    );
    expect(budgetBandAcknowledgement('bb_none')).toMatch(/fixed budget/);
    expect(budgetBandAcknowledgement('bb_forged')).toBeNull();
  });
});

describe('sendBudgetBandPrompt', () => {
  it('sends rent bands to a rent-only lead', async () => {
    const { db } = stubDb({ pref_listing_types: ['Rent'] });

    await sendBudgetBandPrompt({
      db,
      accountId: 'acct-1',
      userId: 'u1',
      contactId: 'c1',
      conversationId: 'conv-1',
    });

    const sent = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      interactiveSections: { rows: { id: string }[] }[];
    };
    expect(
      sent.interactiveSections[0].rows.some((r) => r.id.startsWith('bb_r'))
    ).toBe(true);
  });

  it('sends as the bot through the dispatcher', async () => {
    const { db } = stubDb({ pref_listing_types: ['Sale'] });
    const sent = await sendBudgetBandPrompt({
      db,
      accountId: 'acct-1',
      userId: 'u1',
      contactId: 'c1',
      conversationId: 'conv-1',
    });
    expect(sent).toBe(true);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'interactive',
        interactiveType: 'list',
        senderType: 'bot',
      })
    );
  });
});
