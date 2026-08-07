import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasRecentAgentReply, AGENT_TAKEOVER_WINDOW_MS } from './agent-takeover';

function db(
  rows: { id: string }[] | null,
  error: { message: string } | null = null,
  capture?: { since?: string; senderType?: string },
): SupabaseClient {
  return {
    from() {
      return {
        select() {
          return {
            eq(_col: string, value: unknown) {
              if (capture && _col === 'sender_type') capture.senderType = String(value);
              return {
                eq(col2: string, v2: unknown) {
                  if (capture && col2 === 'sender_type') capture.senderType = String(v2);
                  return {
                    gte(_c: string, since: string) {
                      if (capture) capture.since = since;
                      return {
                        limit: () => Promise.resolve({ data: rows, error }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('hasRecentAgentReply', () => {
  it('is true when an agent replied inside the window', async () => {
    expect(await hasRecentAgentReply(db([{ id: 'm1' }]), 'conv-1')).toBe(true);
  });

  it('is false when only the bot has spoken', async () => {
    expect(await hasRecentAgentReply(db([]), 'conv-1')).toBe(false);
  });

  it('only counts agent messages, inside a 24-hour window', async () => {
    const capture: { since?: string; senderType?: string } = {};
    const now = new Date('2026-08-07T16:21:00Z');
    await hasRecentAgentReply(db([], null, capture), 'conv-1', now);
    expect(capture.senderType).toBe('agent');
    expect(new Date(capture.since!).getTime()).toBe(
      now.getTime() - AGENT_TAKEOVER_WINDOW_MS,
    );
  });

  it('fails open on a lookup error, so a glitch cannot mute every funnel', async () => {
    expect(await hasRecentAgentReply(db(null, { message: 'down' }), 'conv-1')).toBe(false);
  });
});
