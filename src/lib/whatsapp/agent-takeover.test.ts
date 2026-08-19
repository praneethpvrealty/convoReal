import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasRecentAgentReply,
  standDownActiveFlowRuns,
  AGENT_TAKEOVER_WINDOW_MS,
} from './agent-takeover';

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

function flowRunsDb(
  rows: { id: string }[] | null,
  error: { message: string } | null = null,
  capture?: Record<string, unknown>,
): SupabaseClient {
  return {
    from() {
      return {
        update(payload: Record<string, unknown>) {
          if (capture) capture.payload = payload;
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq(col: string, value: unknown) {
                      if (capture) capture.statusFilter = `${col}=${value}`;
                      return {
                        select: () => Promise.resolve({ data: rows, error }),
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

describe('standDownActiveFlowRuns', () => {
  it('ends only ACTIVE runs, marking them paused by the agent', async () => {
    const capture: Record<string, unknown> = {};
    const count = await standDownActiveFlowRuns(
      flowRunsDb([{ id: 'run-1' }], null, capture),
      'a1',
      'c1',
    );
    expect(count).toBe(1);
    expect(capture.statusFilter).toBe('status=active');
    expect(capture.payload).toMatchObject({
      status: 'paused_by_agent',
      end_reason: 'agent_replied',
    });
  });

  it('reports zero when there was nothing to stand down', async () => {
    expect(await standDownActiveFlowRuns(flowRunsDb([]), 'a1', 'c1')).toBe(0);
  });

  it('surfaces a refusal as zero instead of pretending it worked', async () => {
    // The bug this replaced: an RLS refusal came back as zero rows and
    // no error, so the pause silently did nothing for every human reply.
    expect(
      await standDownActiveFlowRuns(flowRunsDb(null, { message: 'denied' }), 'a1', 'c1'),
    ).toBe(0);
  });
});
