import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rate limiting on the public catalog read. The endpoint pages a
 * tenant's published inventory 50 rows at a time and has no callers
 * inside this codebase, so both budgets exist to bound scraping:
 * per-IP for one client draining a catalog, per-account for a
 * distributed scrape of a single brokerage that the per-IP key can't
 * see. The Supabase admin client is stubbed; rate limiting runs for
 * real against the module-global buckets.
 */

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        lte: () => builder,
        or: () => builder,
        ilike: () => builder,
        order: () => builder,
        range: () => Promise.resolve({ data: [], error: null, count: 0 }),
      };
      return builder;
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { GET, getPublicProperties } = await import('./route');
const { RATE_LIMITS, __resetRateLimitForTests } = await import(
  '@/lib/rate-limit'
);

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let ipCounter = 0;
let accountCounter = 0;

/** Fresh IP per call unless pinned — both keys are module-global, so a
 *  shared value would bleed budgets between assertions. */
function req(opts: { ip?: string; account?: string; apiKey?: string } = {}) {
  const account = opts.account ?? `${ACCOUNT.slice(0, -1)}${++accountCounter}`;
  const headers: Record<string, string> = {
    'x-forwarded-for': opts.ip ?? `10.0.0.${++ipCounter}`,
  };
  if (opts.apiKey) headers['x-api-key'] = opts.apiKey;
  return new Request(
    `http://localhost/api/public/properties?account_id=${account}`,
    { headers },
  ) as never;
}

beforeEach(() => {
  __resetRateLimitForTests();
  delete process.env.PUBLIC_API_KEY;
  ipCounter = 0;
  accountCounter = 0;
});

describe('GET /api/public/properties rate limiting', () => {
  it('serves a request under both budgets', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      meta: { source: 'brokerage_published_inventory' },
    });
    expect(res.headers.get('Link')).toContain('/llms.txt');
  });

  it('429s one IP past its budget, and says when to retry', async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < RATE_LIMITS.publicCatalog.limit; i++) {
      // Vary the account so only the per-IP budget is under test.
      expect((await GET(req({ ip }))).status).toBe(200);
    }

    const blocked = await GET(req({ ip }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe(
      String(RATE_LIMITS.publicCatalog.limit),
    );
  });

  it('leaves other IPs unaffected when one is throttled', async () => {
    const noisy = '203.0.113.8';
    for (let i = 0; i < RATE_LIMITS.publicCatalog.limit; i++) {
      await GET(req({ ip: noisy }));
    }
    expect((await GET(req({ ip: noisy }))).status).toBe(429);
    expect((await GET(req({ ip: '203.0.113.9' }))).status).toBe(200);
  });

  it('429s a distributed scrape of one account across many IPs', async () => {
    // Every request comes from a different IP, so the per-IP budget never
    // fires — this is exactly the case the per-account key exists for.
    for (let i = 0; i < RATE_LIMITS.publicCatalogAccount.limit; i++) {
      expect((await GET(req({ account: ACCOUNT }))).status).toBe(200);
    }

    const blocked = await GET(req({ account: ACCOUNT }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe(
      String(RATE_LIMITS.publicCatalogAccount.limit),
    );
  });

  it('throttles before checking the API key, so key guessing is bounded', async () => {
    process.env.PUBLIC_API_KEY = 'the-real-key';
    const ip = '203.0.113.10';

    for (let i = 0; i < RATE_LIMITS.publicCatalog.limit; i++) {
      expect((await GET(req({ ip, apiKey: 'wrong' }))).status).toBe(401);
    }

    // Budget spent on bad guesses — the next one never reaches the check.
    expect((await GET(req({ ip, apiKey: 'wrong' }))).status).toBe(429);
    expect((await GET(req({ ip, apiKey: 'the-real-key' }))).status).toBe(429);
  });

  it('still throttles a caller holding a valid API key', async () => {
    process.env.PUBLIC_API_KEY = 'the-real-key';
    const ip = '203.0.113.11';

    for (let i = 0; i < RATE_LIMITS.publicCatalog.limit; i++) {
      expect((await GET(req({ ip, apiKey: 'the-real-key' }))).status).toBe(200);
    }
    expect((await GET(req({ ip, apiKey: 'the-real-key' }))).status).toBe(429);
  });

  it('allows the separately rate-limited public agent feed without exposing the legacy key', async () => {
    process.env.PUBLIC_API_KEY = 'the-real-key';
    const response = await getPublicProperties(req(), {
      requireConfiguredApiKey: false,
    });
    expect(response.status).toBe(200);
  });
});
