import { beforeEach, describe, expect, it, vi } from 'vitest';

const limits: string[] = [];
const lookups: Array<{ schedule: unknown; options: unknown }> = [];
let limitFails: string | null = null;
let lookupFails = false;

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string) => {
    limits.push(key);
    return { success: !(limitFails && key.startsWith(limitFails)) };
  },
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

vi.mock('@/lib/guidance-value/server', () => ({
  lookupGuidanceValue: async (
    _db: unknown,
    schedule: unknown,
    options: unknown
  ) => {
    if (lookupFails) throw new Error('db down');
    lookups.push({ schedule, options });
    return { schedule, desired_class: null, matches: [], coverage: 'no_rates' };
  },
}));

import { POST } from './route';

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://test/api/public/guidance-value/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  limits.length = 0;
  lookups.length = 0;
  limitFails = null;
  lookupFails = false;
});

describe('POST /api/public/guidance-value/lookup', () => {
  it('[PUB-001] matches a typed schedule with no sign-in, file read or credit burn', async () => {
    const res = await post(
      {
        schedule: {
          district: 'Bengaluru Urban',
          locality: 'Koramangala 6th Block',
          kind: 'site',
          land_area: { value: 2400, unit: 'sqft' },
        },
        options: { building_rate_per_sqft: 1800 },
      },
      { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.coverage).toBe('no_rates');
    expect(body.credits).toBeUndefined();
    expect(lookups).toHaveLength(1);
    expect(lookups[0].schedule).toMatchObject({
      district: 'Bengaluru Urban',
      locality: 'Koramangala 6th Block',
      kind: 'site',
      land_area: { value: 2400, unit: 'sqft' },
    });
    expect(lookups[0].options).toEqual({ building_rate_per_sqft: 1800 });
    expect(limits).toEqual([
      'publicGuidance:ip:203.0.113.9',
      'publicGuidance:global',
    ]);
  });

  it('[PUB-001] refuses a file upload instead of reading it', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(8)], 'schedule.pdf', {
        type: 'application/pdf',
      })
    );
    const res = await POST(
      new Request('http://test/api/public/guidance-value/lookup', {
        method: 'POST',
        body: form,
      })
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SIGN_IN_REQUIRED');
    expect(lookups).toHaveLength(0);
    expect(limits).toHaveLength(0);
  });

  it('[PUB-001] requires an area, village or city', async () => {
    const res = await post({ schedule: { district: 'Bengaluru Urban' } });
    expect(res.status).toBe(400);
    expect(lookups).toHaveLength(0);
  });

  it('[PUB-001] is rate-limited per IP and globally before any search', async () => {
    limitFails = 'publicGuidance:ip:';
    let res = await post({ schedule: { locality: 'Jayanagar' } });
    expect(res.status).toBe(429);

    limitFails = 'publicGuidance:global';
    res = await post({ schedule: { locality: 'Jayanagar' } });
    expect(res.status).toBe(429);
    expect(lookups).toHaveLength(0);
  });

  it('[PUB-001] reports a search failure without leaking it', async () => {
    lookupFails = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ schedule: { locality: 'Jayanagar' } });
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toContain('db down');
    spy.mockRestore();
  });
});
