import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { toRangeInsights } from './insights';
import { loadRangeInsights } from './queries';

function stubDb(result: { data: unknown; error?: unknown }) {
  const maybeSingle = vi.fn(async () => ({
    data: result.data,
    error: result.error ?? null,
  }));
  const rpc = vi.fn(() => ({ maybeSingle }));
  const from = vi.fn();
  const db = { rpc, from } as unknown as SupabaseClient;
  return { db, rpc, from, maybeSingle };
}

const start = new Date('2026-10-03T18:30:00.000Z');
const end = new Date('2026-10-04T18:29:59.999Z');

describe('loadRangeInsights', () => {
  it('asks today_insights for the account and range in one call', async () => {
    const { db, rpc, from, maybeSingle } = stubDb({
      data: {
        new_inquiries: 4,
        new_contacts: 3,
        messages_received: 21,
        messages_sent: 17,
        inbound_conversations: 6,
        responded_conversations: 5,
        showcase_opens: 9,
      },
    });

    const insights = await loadRangeInsights(db, 'acct-1', start, end);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('today_insights', {
      p_account_id: 'acct-1',
      p_start: '2026-10-03T18:30:00.000Z',
      p_end: '2026-10-04T18:29:59.999Z',
    });
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
    expect(insights).toEqual({
      newInquiries: 4,
      newContacts: 3,
      messagesReceived: 21,
      messagesSent: 17,
      inboundConversations: 6,
      respondedConversations: 5,
      showcaseOpens: 9,
    });
  });

  it('reads no row as an empty day', async () => {
    const { db } = stubDb({ data: null });

    await expect(loadRangeInsights(db, 'acct-1', start, end)).resolves.toEqual({
      newInquiries: 0,
      newContacts: 0,
      messagesReceived: 0,
      messagesSent: 0,
      inboundConversations: 0,
      respondedConversations: 0,
      showcaseOpens: 0,
    });
  });

  it('throws the RPC error rather than reporting zeros', async () => {
    const failure = { message: 'permission denied for function' };
    const { db } = stubDb({ data: null, error: failure });

    await expect(loadRangeInsights(db, 'acct-1', start, end)).rejects.toBe(
      failure
    );
  });
});

describe('toRangeInsights', () => {
  it('keeps zeros and turns null columns into zeros', () => {
    expect(
      toRangeInsights({
        new_inquiries: 0,
        new_contacts: null,
        messages_received: 2,
        messages_sent: null,
        inbound_conversations: 1,
        responded_conversations: 0,
        showcase_opens: null,
      })
    ).toEqual({
      newInquiries: 0,
      newContacts: 0,
      messagesReceived: 2,
      messagesSent: 0,
      inboundConversations: 1,
      respondedConversations: 0,
      showcaseOpens: 0,
    });
  });

  it('reads bigint columns that arrive as strings', () => {
    expect(
      toRangeInsights({
        new_inquiries: '12',
        new_contacts: '0',
        messages_received: '340',
        messages_sent: '298',
        inbound_conversations: '41',
        responded_conversations: '39',
        showcase_opens: '7',
      })
    ).toEqual({
      newInquiries: 12,
      newContacts: 0,
      messagesReceived: 340,
      messagesSent: 298,
      inboundConversations: 41,
      respondedConversations: 39,
      showcaseOpens: 7,
    });
  });

  it('reads an undefined row as zeros', () => {
    expect(toRangeInsights(undefined)).toEqual({
      newInquiries: 0,
      newContacts: 0,
      messagesReceived: 0,
      messagesSent: 0,
      inboundConversations: 0,
      respondedConversations: 0,
      showcaseOpens: 0,
    });
  });
});
