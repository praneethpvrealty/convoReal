import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const sendPreferenceFlowToContact = vi.fn();
const createNotification = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/whatsapp/meta-flow-service', () => ({
  sendPreferenceFlowToContact: (...args: unknown[]) =>
    sendPreferenceFlowToContact(...args),
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

const sendBudgetBandPrompt = vi.fn();

vi.mock('@/lib/whatsapp/budget-band', () => ({
  sendBudgetBandPrompt: (...args: unknown[]) => sendBudgetBandPrompt(...args),
}));

const {
  buildListingFeedbackSections,
  sendListingFeedbackPrompt,
  handleListingFeedbackReply,
} = await import('./listing-feedback');

/**
 * A listings message asks for a typed reply; most leads never type.
 * These pin the tap-based capture: every verdict lands on
 * listing_feedback (which rankings read back), a rejection asks why,
 * and nothing embedded in a webhook id is trusted.
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

import type { RankedPropertyMatch } from '@/lib/radar/engine';

const match = (id: string, title: string) =>
  ({
    property: { id, title },
    score: 85,
    details: {},
  }) as unknown as RankedPropertyMatch;

describe('buildListingFeedbackSections', () => {
  it('offers one row per listing, then the none-fit row', () => {
    const [section] = buildListingFeedbackSections([
      match(P1, 'Plot in Koramangala'),
      match(P2, 'Office in HSR'),
    ]);

    expect(section.rows.map((r) => r.id)).toEqual([
      `lfb_y_${P1}`,
      `lfb_y_${P2}`,
      `lfb_n_${P1}.${P2}`,
    ]);
    // Meta caps row titles at 24 chars — a longer one fails the send.
    for (const row of section.rows) {
      expect(row.title.length).toBeLessThanOrEqual(24);
    }
  });

  it('adds the form row only when asked, so the post-form path never re-offers the form', () => {
    const withForm = buildListingFeedbackSections([match(P1, 'A')], {
      includeFormRow: true,
    });
    const without = buildListingFeedbackSections([match(P1, 'A')]);

    expect(withForm[0].rows.some((r) => r.id === 'lfb_form')).toBe(true);
    expect(without[0].rows.some((r) => r.id === 'lfb_form')).toBe(false);
  });
});

/** Chainable query stub: every method returns itself; awaiting any
 *  chain resolves to the next queued result. */
function stubDb(results: Record<string, unknown[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const queues = new Map(Object.entries(results));
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const handler =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    for (const m of [
      'select',
      'eq',
      'in',
      'upsert',
      'update',
      'order',
      'limit',
    ]) {
      chain[m] = handler(m);
    }
    chain.maybeSingle = async () => {
      calls.push({ table, method: 'maybeSingle', args: [] });
      const q = queues.get(table) ?? [];
      return { data: q.shift() ?? null };
    };
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const q = queues.get(table) ?? [];
      return Promise.resolve(resolve({ data: q.shift() ?? null }));
    };
    return chain;
  };
  return { db: { from } as never, calls };
}

const baseArgs = (db: never, replyId: string) => ({
  db,
  accountId: 'acct-1',
  configOwnerUserId: 'owner-1',
  contact: { id: 'c1', name: 'Sanjuali' },
  conversationId: 'conv-1',
  replyId,
});

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  sendPreferenceFlowToContact.mockResolvedValue({ success: true });
  createNotification.mockResolvedValue({});
});

describe('handleListingFeedbackReply', () => {
  it('ignores ids it does not own, so other handlers still run', async () => {
    const { db } = stubDb({});
    expect(
      await handleListingFeedbackReply(baseArgs(db, 'browse_all_properties'))
    ).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('files interest, confirms to the lead, and pings the agent', async () => {
    const { db, calls } = stubDb({
      properties: [{ id: P1, title: 'Plot in Koramangala', user_id: 'u9' }],
      contacts: [{ assigned_agent_id: 'agent-7' }],
    });

    const handled = await handleListingFeedbackReply(
      baseArgs(db, `lfb_y_${P1}`)
    );

    expect(handled).toBe(true);
    const upsert = calls.find(
      (c) => c.table === 'listing_feedback' && c.method === 'upsert'
    );
    expect(upsert?.args[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'c1',
      property_id: P1,
      verdict: 'interested',
    });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Plot in Koramangala'),
      })
    );
    // Interest is perishable — the assigned agent hears about it now.
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'agent-7', type: 'listing_interest' })
    );
  });

  it('records nothing for a property outside the account', async () => {
    // The id arrives from the webhook; a forged UUID must die at the
    // account-scoped read, not become a feedback row.
    const { db, calls } = stubDb({ properties: [] });

    await handleListingFeedbackReply(baseArgs(db, `lfb_y_${P1}`));

    expect(
      calls.some((c) => c.table === 'listing_feedback' && c.method === 'upsert')
    ).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('rejects every shown listing at once and asks why with one-tap reasons', async () => {
    const { db, calls } = stubDb({ properties: [[{ id: P1 }, { id: P2 }]] });

    const handled = await handleListingFeedbackReply(
      baseArgs(db, `lfb_n_${P1}.${P2}`)
    );

    expect(handled).toBe(true);
    const upsert = calls.find(
      (c) => c.table === 'listing_feedback' && c.method === 'upsert'
    );
    expect(upsert).toBeTruthy();
    const sent = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      interactiveSections: { rows: { id: string; title: string }[] }[];
    };
    const rowIds = sent.interactiveSections[0].rows.map((r) => r.id);
    expect(rowIds.some((id) => id.startsWith('lfbr_budget_'))).toBe(true);
    expect(rowIds.some((id) => id.startsWith('lfbr_location_'))).toBe(true);
  });

  it('drops malformed ids inside a none-fit tap instead of trusting them', async () => {
    const { db } = stubDb({ properties: [] });
    const handled = await handleListingFeedbackReply(
      baseArgs(db, 'lfb_n_DROP TABLE.properties')
    );
    expect(handled).toBe(false);
  });

  it('files the rejection reason and asks the pointed follow-up', async () => {
    const { db, calls } = stubDb({});

    const handled = await handleListingFeedbackReply(
      baseArgs(db, `lfbr_location_${P1}.${P2}`)
    );

    expect(handled).toBe(true);
    const update = calls.find(
      (c) => c.table === 'listing_feedback' && c.method === 'update'
    );
    expect(update?.args[0]).toEqual({ reason: 'location' });
    // The question must be answerable by replying — the qualification
    // ladder files a bare answer after a bot question as the answer.
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('which areas'),
      })
    );
  });

  it('answers a budget rejection with the tappable band list, not a typed question', async () => {
    const { db, calls } = stubDb({});

    const handled = await handleListingFeedbackReply(
      baseArgs(db, `lfbr_budget_${P1}`)
    );

    expect(handled).toBe(true);
    const update = calls.find(
      (c) => c.table === 'listing_feedback' && c.method === 'update'
    );
    expect(update?.args[0]).toEqual({ reason: 'budget' });
    expect(sendBudgetBandPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', conversationId: 'conv-1' })
    );
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('sends the full form when the form row is tapped', async () => {
    const { db } = stubDb({});

    const handled = await handleListingFeedbackReply(baseArgs(db, 'lfb_form'));

    expect(handled).toBe(true);
    expect(sendPreferenceFlowToContact).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-1', contactId: 'c1' })
    );
  });

  it('consumes the tap even when recording fails, so no other handler mangles it', async () => {
    sendWhatsAppMessageAndPersist.mockRejectedValue(new Error('db down'));
    const { db } = stubDb({});

    const handled = await handleListingFeedbackReply(
      baseArgs(db, `lfbr_other_${P1}`)
    );

    expect(handled).toBe(true);
  });
});

describe('sendListingFeedbackPrompt', () => {
  it('sends nothing when there were no listings to judge', async () => {
    const { db } = stubDb({});
    const sent = await sendListingFeedbackPrompt({
      db,
      accountId: 'acct-1',
      userId: 'u1',
      contactId: 'c1',
      conversationId: 'conv-1',
      matches: [],
    });
    expect(sent).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('sends the list as the bot inside the open window', async () => {
    const { db } = stubDb({});
    const sent = await sendListingFeedbackPrompt({
      db,
      accountId: 'acct-1',
      userId: 'u1',
      contactId: 'c1',
      conversationId: 'conv-1',
      matches: [match(P1, 'Plot')],
      includeFormRow: true,
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
