import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as { id: string }[],
  filters: [] as Array<[string, string, unknown]>,
  rateLimitSuccess: true,
  rateLimitKeys: [] as string[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from() {
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => (h.filters.push(['eq', c, v]), chain),
        like: (c: string, v: unknown) => (
          h.filters.push(['like', c, v]),
          chain
        ),
        gte: (c: string, v: unknown) => (h.filters.push(['gte', c, v]), chain),
        limit: () => Promise.resolve({ data: h.rows, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string) => {
    h.rateLimitKeys.push(key);
    return { success: h.rateLimitSuccess, remaining: 0, reset: 0, limit: 1 };
  },
}));

import {
  CREDITS_LOCKED_NOTICE_PREFIX,
  CREDITS_LOCKED_NOTICE_WINDOW_MS,
  claimCreditsLockedNotice,
} from './locked-notice';

describe('[CRD-006] out-of-credits notice is sent once per conversation', () => {
  beforeEach(() => {
    h.rows = [];
    h.filters = [];
    h.rateLimitSuccess = true;
    h.rateLimitKeys = [];
  });

  it('claims the notice when none was sent in the window', async () => {
    const now = Date.parse('2026-11-18T07:00:00Z');
    expect(await claimCreditsLockedNotice('conv-1', now)).toBe(true);
    expect(h.filters).toContainEqual(['eq', 'conversation_id', 'conv-1']);
    expect(h.filters).toContainEqual([
      'like',
      'content_text',
      `${CREDITS_LOCKED_NOTICE_PREFIX}%`,
    ]);
    expect(h.filters).toContainEqual([
      'gte',
      'created_at',
      new Date(now - CREDITS_LOCKED_NOTICE_WINDOW_MS).toISOString(),
    ]);
    expect(h.rateLimitKeys).toEqual(['credits-locked-notice:conv-1']);
  });

  it('suppresses the notice when one is already in the thread', async () => {
    h.rows = [{ id: 'm1' }];
    expect(await claimCreditsLockedNotice('conv-1')).toBe(false);
    expect(h.rateLimitKeys).toEqual([]);
  });

  it('suppresses a concurrent burst that loses the claim', async () => {
    h.rateLimitSuccess = false;
    expect(await claimCreditsLockedNotice('conv-1')).toBe(false);
  });

  it('every locked-reply sender goes through the claim', () => {
    const engine = readFileSync('src/lib/ai/chatbot-engine.ts', 'utf8');
    const sender = engine.slice(
      engine.indexOf('async function sendCreditsLockedReply('),
      engine.indexOf('async function sendCreditsLockedReply(') + 600
    );
    expect(sender).toContain(
      'if (!(await claimCreditsLockedNotice(conversationId))) return true;'
    );
    const scheduler = readFileSync(
      'src/lib/calendar/whatsapp-scheduler.ts',
      'utf8'
    );
    const notices = scheduler.split('🔒 *Out of AI credits').length - 1;
    const claims =
      scheduler.split('if (await claimCreditsLockedNotice(conversation.id))')
        .length - 1;
    expect(notices).toBe(2);
    expect(claims).toBe(notices);
  });
});
