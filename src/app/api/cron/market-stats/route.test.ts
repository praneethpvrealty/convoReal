import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the auth gate + disabled short-circuit on the market-stats
 * cron. The engine is covered in src/lib/market/stats-engine.test.ts;
 * here the Supabase client is stubbed so getMarketStatsConfig() reads
 * "no config" → defaults (disabled) and the route never reaches the
 * engine.
 */

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return builder;
    },
  }),
}));

let GET: (req: Request) => Promise<Response>;
const url = 'http://localhost/api/cron/market-stats';

beforeEach(async () => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
});

describe('market-stats cron auth', () => {
  it('fails closed (503) when no secret is configured', async () => {
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
  });

  it('rejects a missing credential (401)', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'sekret';
    const res = await GET(new Request(url));
    expect(res.status).toBe(401);
  });

  it('rejects a wrong same-length secret (401, constant-time path)', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'sekret';
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'wrong6' } }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a wrong Bearer token (401)', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'sekret';
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer nope' } }),
    );
    expect(res.status).toBe(401);
  });
});

describe('market-stats disabled short-circuit', () => {
  it('returns skipped when authorized but config is disabled (default)', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'sekret';
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'sekret' } }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ skipped: 'disabled' });
  });

  it("accepts Vercel Cron's Authorization: Bearer against CRON_SECRET", async () => {
    process.env.CRON_SECRET = 'vercel-secret';
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer vercel-secret' } }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ skipped: 'disabled' });
  });
});
