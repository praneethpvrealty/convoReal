import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * latestBotTarget backs the plain reply — an agent answering "how did
 * it go?" the way they would answer a person, without quoting.
 */

interface Row {
  message_id: string | null;
  created_at: string;
}

let messages: Row[] = [];
let targets: Array<{ entity_type: string; entity_id: string; wa_message_id: string }> = [];
let messageFilters: Record<string, unknown>;
let targetFilters: Record<string, unknown>;

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db }));

const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    if (table === 'messages') messageFilters = filters;
    else targetFilters = filters;
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      not: () => builder,
      gte: (col: string, val: unknown) => {
        filters[`gte_${col}`] = val;
        return builder;
      },
      in: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      order: () => builder,
      limit: (n: number) => {
        filters.limit = n;
        return builder;
      },
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: table === 'messages' ? messages : targets, error: null }),
    });
    return builder;
  },
};

const { latestBotTarget } = await import('./bot-message-target');

beforeEach(() => {
  messages = [];
  targets = [];
});

describe('latestBotTarget', () => {
  it('finds the appointment card the agent just answered', async () => {
    messages = [{ message_id: 'wamid.nudge', created_at: '2026-08-08T13:01:00Z' }];
    targets = [{ entity_type: 'appointment', entity_id: 'appt-1', wa_message_id: 'wamid.nudge' }];

    expect(
      await latestBotTarget({
        accountId: 'acc',
        conversationId: 'conv-1',
        entityType: 'appointment',
      }),
    ).toEqual({ entityType: 'appointment', entityId: 'appt-1' });
  });

  it('picks the newest card when the thread holds several', async () => {
    // messages come back newest-first, and the answer is about the
    // question that was just asked — not one from two days ago.
    messages = [
      { message_id: 'wamid.new', created_at: '2026-08-08T13:00:00Z' },
      { message_id: 'wamid.old', created_at: '2026-08-07T09:00:00Z' },
    ];
    targets = [
      { entity_type: 'appointment', entity_id: 'appt-old', wa_message_id: 'wamid.old' },
      { entity_type: 'appointment', entity_id: 'appt-new', wa_message_id: 'wamid.new' },
    ];

    expect(
      (await latestBotTarget({ accountId: 'acc', conversationId: 'conv-1', entityType: 'appointment' }))
        ?.entityId,
    ).toBe('appt-new');
  });

  it('scopes to the conversation, the account and bot messages only', async () => {
    messages = [{ message_id: 'wamid.a', created_at: '2026-08-08T13:00:00Z' }];
    targets = [{ entity_type: 'appointment', entity_id: 'appt-1', wa_message_id: 'wamid.a' }];

    await latestBotTarget({ accountId: 'acc', conversationId: 'conv-1', entityType: 'appointment' });

    expect(messageFilters).toMatchObject({ conversation_id: 'conv-1', sender_type: 'bot' });
    expect(targetFilters).toMatchObject({ account_id: 'acc', entity_type: 'appointment' });
  });

  it('bounds the search so a stray "done" cannot reach an old card', async () => {
    messages = [{ message_id: 'wamid.a', created_at: '2026-08-08T13:00:00Z' }];
    targets = [];

    await latestBotTarget({
      accountId: 'acc',
      conversationId: 'conv-1',
      entityType: 'appointment',
      withinHours: 6,
    });

    const since = new Date(messageFilters.gte_created_at as string).getTime();
    expect(Date.now() - since).toBeGreaterThan(5.9 * 3600_000);
    expect(Date.now() - since).toBeLessThan(6.1 * 3600_000);
    expect(messageFilters.limit).toBe(10);
  });

  it('is null when the recent cards are about something else', async () => {
    messages = [{ message_id: 'wamid.a', created_at: '2026-08-08T13:00:00Z' }];
    targets = [];

    expect(
      await latestBotTarget({ accountId: 'acc', conversationId: 'conv-1', entityType: 'appointment' }),
    ).toBeNull();
  });

  it('is null on a thread with no bot messages at all', async () => {
    expect(
      await latestBotTarget({ accountId: 'acc', conversationId: 'conv-1', entityType: 'appointment' }),
    ).toBeNull();
  });

  it('ignores a bot message that never got a wamid', async () => {
    messages = [{ message_id: null, created_at: '2026-08-08T13:00:00Z' }];
    targets = [{ entity_type: 'appointment', entity_id: 'appt-1', wa_message_id: 'wamid.a' }];

    expect(
      await latestBotTarget({ accountId: 'acc', conversationId: 'conv-1', entityType: 'appointment' }),
    ).toBeNull();
  });
});
