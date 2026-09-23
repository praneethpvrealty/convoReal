import { beforeEach, describe, expect, it, vi } from 'vitest';

let caller:
  | { kind: 'staff'; userId: string; ctx: { accountId: string } }
  | { kind: 'portal'; userId: string };
let extractFails = false;
let burnOk = true;
const burns: string[] = [];
const refunds: string[] = [];
const limits: string[] = [];
const lookups: unknown[] = [];

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: async (accountId: string) => {
    burns.push(accountId);
    return burnOk ? { success: true } : { success: false, deficit: 3 };
  },
  refundCredits: async (accountId: string) => {
    refunds.push(accountId);
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: {
    guidanceValueRead: {},
    guidanceValuePortalDaily: {},
    guidanceValueMatch: {},
  },
  checkRateLimit: async (key: string) => {
    limits.push(key.split(':')[0]);
    return { success: true };
  },
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

vi.mock('@/lib/guidance-value/schedule', async () => {
  const fields = await import('@/lib/guidance-value/schedule-fields');
  return {
    ...fields,
    extractSchedule: async () => {
      if (extractFails) throw new Error('model down');
      return { locality: 'Koramangala 6th Block', road: '18th Main' };
    },
  };
});

vi.mock('@/lib/guidance-value/server', () => {
  return {
    resolveGuidanceCaller: async () => caller,
    lookupGuidanceValue: async (
      _db: unknown,
      schedule: unknown,
      options: unknown
    ) => {
      lookups.push({ schedule, options });
      return {
        schedule,
        desired_class: null,
        matches: [],
        coverage: 'no_rates',
      };
    },
  };
});

import { POST } from './route';

function upload(type = 'application/pdf', size = 10) {
  const form = new FormData();
  form.append(
    'file',
    new File([new Uint8Array(size)], 'schedule.pdf', { type })
  );
  form.append('options', JSON.stringify({ land_area_sqft: 2400 }));
  return POST(
    new Request('http://test/api/guidance-value/lookup', {
      method: 'POST',
      body: form,
    })
  );
}

function rematch(body: unknown) {
  return POST(
    new Request('http://test/api/guidance-value/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  caller = { kind: 'staff', userId: 'u1', ctx: { accountId: 'acc-1' } };
  extractFails = false;
  burnOk = true;
  burns.length = 0;
  refunds.length = 0;
  limits.length = 0;
  lookups.length = 0;
});

describe('POST /api/guidance-value/lookup', () => {
  it('[GVL-001] reads a schedule for staff, burning credits once', async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.schedule.locality).toBe('Koramangala 6th Block');
    expect(body.credits.spent).toBe(5);
    expect(burns).toEqual(['acc-1']);
    expect(lookups[0]).toMatchObject({ options: { land_area_sqft: 2400 } });
  });

  it('refunds staff credits when the read fails', async () => {
    extractFails = true;
    const res = await upload();
    expect(res.status).toBe(502);
    expect(refunds).toEqual(['acc-1']);
  });

  it('refuses a read when the wallet is short', async () => {
    burnOk = false;
    const res = await upload();
    expect(res.status).toBe(402);
    expect(lookups).toHaveLength(0);
  });

  it('lets Portfolio users read free under a daily limit', async () => {
    caller = { kind: 'portal', userId: 'p1' };
    const res = await upload();
    expect(res.status).toBe(200);
    expect(burns).toHaveLength(0);
    expect(limits).toContain('guidanceReadDaily');
    expect((await res.json()).credits.spent).toBe(0);
  });

  it('[GVL-001] refuses unsupported and oversized files before any charge', async () => {
    expect((await upload('image/heic')).status).toBe(415);
    expect((await upload('application/pdf', 5 * 1024 * 1024)).status).toBe(413);
    expect(burns).toHaveLength(0);
  });

  it('[GVL-001] re-matches an edited schedule without reading or charging', async () => {
    const res = await rematch({
      schedule: { locality: 'Jayanagar 4th Block' },
    });
    expect(res.status).toBe(200);
    expect(burns).toHaveLength(0);
    expect(limits).toEqual(['guidanceMatch']);
  });

  it('asks for a place when the edited schedule has none', async () => {
    const res = await rematch({ schedule: { road: '18th Main' } });
    expect(res.status).toBe(400);
  });
});
