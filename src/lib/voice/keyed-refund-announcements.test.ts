import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  burnCredits: vi.fn(),
  refundBurn: vi.fn(),
  refundCredits: vi.fn(),
  insert: vi.fn(),
  insertFails: false,
  announcementRow: { current: null as Record<string, unknown> | null },
  selectedColumns: { current: '' },
  updates: [] as Record<string, unknown>[],
  rpush: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: () => {
    throw new Error('tts unavailable');
  },
}));
vi.mock('@/lib/credits/burn', () => ({
  burnCredits: (...args: unknown[]) => h.burnCredits(...args),
  refundCredits: (...args: unknown[]) => h.refundCredits(...args),
}));
vi.mock('@/lib/credits/refund-burn', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/credits/refund-burn')
  >('@/lib/credits/refund-burn');
  return {
    newBurnKey: actual.newBurnKey,
    refundBurn: (...args: unknown[]) => h.refundBurn(...args),
  };
});
vi.mock('@/lib/video/listing-video-worker', () => ({
  chunkNarration: (text: string) => [text],
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: (columns: string) => {
        h.selectedColumns.current = columns;
        const chain = {
          eq: () => chain,
          maybeSingle: async () => ({ data: h.announcementRow.current }),
        };
        return chain;
      },
      update: (patch: Record<string, unknown>) => {
        h.updates.push(patch);
        const chain = { eq: () => chain, select: async () => ({ data: [] }) };
        return chain;
      },
    }),
    storage: { from: () => ({}) },
  }),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          h.insert(row);
          return {
            select: () => ({
              single: async () =>
                h.insertFails
                  ? { data: null, error: { message: 'insert blew up' } }
                  : {
                      data: {
                        id: 'ann-1',
                        title: row.title,
                        status: 'pending',
                        language: row.language,
                      },
                      error: null,
                    },
            }),
          };
        },
      }),
    },
  }),
  getCurrentAccount: async () => ({}),
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('ioredis', () => ({
  default: class {
    connect = async () => undefined;
    rpush = (...args: unknown[]) => h.rpush(...args);
    disconnect = () => undefined;
  },
}));

import { NextRequest } from 'next/server';
import { processAnnouncementAudioJob } from './announcement-worker';
import { POST } from '@/app/api/announcements/route';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const job = {
  kind: 'announcement_audio' as const,
  announcementId: 'ann-1',
  accountId: 'acct-1',
};

const announcement = {
  id: 'ann-1',
  account_id: 'acct-1',
  title: 'Open house',
  body_text: 'Join us on Sunday',
  language: 'en-IN',
  status: 'pending',
};

const post = () =>
  POST(
    new NextRequest('http://localhost/api/announcements', {
      method: 'POST',
      body: JSON.stringify({ title: 'Open house', text: 'Join us on Sunday' }),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.updates.length = 0;
  h.insertFails = false;
  h.announcementRow.current = null;
  h.burnCredits.mockResolvedValue({
    success: true,
    balanceAfter: 90,
    deficit: 0,
  });
  h.refundBurn.mockResolvedValue({ status: 'refunded', refunded: 100 });
  h.refundCredits.mockResolvedValue({ success: true, balanceAfter: 100 });
  process.env.REDIS_URL = 'redis://localhost:6379';
});

describe('an announcement render that fails [CRD-005]', () => {
  it('refunds by the row’s own burn key and never by amount', async () => {
    h.announcementRow.current = {
      ...announcement,
      burn_key: 'audio_announcement:key-1',
    };

    await processAnnouncementAudioJob(job);

    expect(h.updates[0]).toMatchObject({ status: 'failed' });
    expect(h.refundBurn).toHaveBeenCalledTimes(1);
    expect(h.refundBurn).toHaveBeenCalledWith(
      'acct-1',
      'audio_announcement',
      'audio_announcement:key-1',
      expect.objectContaining({ reason: expect.stringContaining('ann-1') })
    );
    expect(h.refundCredits).not.toHaveBeenCalled();
  });

  it('refunds a row created before keys existed by feature and amount, as before', async () => {
    h.announcementRow.current = { ...announcement, burn_key: null };

    await processAnnouncementAudioJob(job);

    expect(h.refundBurn).not.toHaveBeenCalled();
    expect(h.refundCredits).toHaveBeenCalledTimes(1);
    expect(h.refundCredits).toHaveBeenCalledWith(
      'acct-1',
      'audio_announcement',
      AI_FEATURE_COSTS.audio_announcement,
      { description: 'audio_announcement generation refund (ann-1)' }
    );
  });

  it('reads burn_key with the row', async () => {
    h.announcementRow.current = { ...announcement, burn_key: null };

    await processAnnouncementAudioJob(job);

    expect(h.selectedColumns.current).toContain('burn_key');
  });
});

describe('creating an announcement [CRD-005]', () => {
  it('burns under a key and stores that same key on the row', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(h.burnCredits).toHaveBeenCalledTimes(1);
    const [accountId, feature, cost, opts] = h.burnCredits.mock.calls[0];
    expect(accountId).toBe('acct-1');
    expect(feature).toBe('audio_announcement');
    expect(cost).toBe(AI_FEATURE_COSTS.audio_announcement);
    expect(opts.retryKey).toMatch(/^audio_announcement:[0-9a-f-]{36}$/);
    expect(h.insert).toHaveBeenCalledWith(
      expect.objectContaining({ burn_key: opts.retryKey })
    );
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('refunds the charge by its key when the row cannot be inserted', async () => {
    h.insertFails = true;

    const res = await post();

    expect(res.status).toBe(500);
    const retryKey = h.burnCredits.mock.calls[0][3].retryKey;
    expect(h.refundBurn).toHaveBeenCalledTimes(1);
    expect(h.refundBurn).toHaveBeenCalledWith(
      'acct-1',
      'audio_announcement',
      retryKey,
      expect.objectContaining({ reason: expect.any(String) })
    );
    expect(h.refundCredits).not.toHaveBeenCalled();
    expect(h.rpush).not.toHaveBeenCalled();
  });

  it('refunds nothing when the burn was refused', async () => {
    h.burnCredits.mockResolvedValue({
      success: false,
      balanceAfter: 0,
      deficit: 100,
    });

    const res = await post();

    expect(res.status).toBe(402);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.refundBurn).not.toHaveBeenCalled();
  });
});

describe('the burn_key migration [CRD-005]', () => {
  it('is purely additive: one nullable column, no other change', () => {
    const sql = read(
      'supabase/migrations/20261004190000_voice_announcements_burn_key.sql'
    ).trim();

    expect(sql).toBe(
      'ALTER TABLE public.voice_announcements\n  ADD COLUMN IF NOT EXISTS burn_key text;'
    );
  });
});
