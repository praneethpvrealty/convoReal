import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AGENT_HANDLING_WINDOW_MS,
  agentHandledRecently,
  agentHandlingThread,
} from './agent-handling';

const NOW = new Date('2026-10-26T10:35:16Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('[INB-046] agentHandledRecently', () => {
  it('counts an agent message inside the window even when the bot wrote after it', () => {
    expect(
      agentHandledRecently(
        [
          { sender_type: 'customer', created_at: ago(26_000) },
          { sender_type: 'bot', created_at: ago(47_000) },
          { sender_type: 'agent', created_at: ago(3 * 60_000) },
        ],
        NOW
      )
    ).toBe(true);
  });

  it('lets an agent message older than the window go', () => {
    expect(
      agentHandledRecently(
        [
          {
            sender_type: 'agent',
            created_at: ago(AGENT_HANDLING_WINDOW_MS + 1),
          },
        ],
        NOW
      )
    ).toBe(false);
  });

  it('never counts a message without a timestamp, or one that is not an agent’s', () => {
    expect(
      agentHandledRecently(
        [
          { sender_type: 'agent' },
          { sender_type: 'bot', created_at: ago(1_000) },
          { sender_type: 'customer', created_at: ago(1_000) },
        ],
        NOW
      )
    ).toBe(false);
  });
});

function dbReturning(result: { data: unknown; error: unknown }) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    gte: (column: string, value: unknown) => {
      filters[`${column}>=`] = value;
      return builder;
    },
    limit: () => builder,
    maybeSingle: async () => result,
  };
  return {
    db: { from: () => builder } as unknown as SupabaseClient,
    filters,
  };
}

describe('[INB-046] agentHandlingThread', () => {
  it('reads an agent message in this conversation and account within the window', async () => {
    const { db, filters } = dbReturning({ data: { id: 'm1' }, error: null });
    expect(await agentHandlingThread(db, 'acct-1', 'conv-1', NOW)).toBe(true);
    expect(filters).toEqual({
      conversation_id: 'conv-1',
      account_id: 'acct-1',
      sender_type: 'agent',
      'created_at>=': ago(AGENT_HANDLING_WINDOW_MS),
    });
  });

  it('is false when no agent wrote in the window, or there is no conversation', async () => {
    expect(
      await agentHandlingThread(
        dbReturning({ data: null, error: null }).db,
        'acct-1',
        'conv-1',
        NOW
      )
    ).toBe(false);
    expect(
      await agentHandlingThread(
        dbReturning({ data: { id: 'm1' }, error: null }).db,
        'acct-1',
        null,
        NOW
      )
    ).toBe(false);
  });

  it('holds the bot back when the lookup fails', async () => {
    expect(
      await agentHandlingThread(
        dbReturning({ data: null, error: { message: 'timeout' } }).db,
        'acct-1',
        'conv-1',
        NOW
      )
    ).toBe(true);
  });
});
