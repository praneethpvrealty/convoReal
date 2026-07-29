import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Share-instance stamping on the public Pulse beacon (migration 173):
 * a valid share token from the same account labels the inserted
 * events; a token from another account (or garbage) must be dropped,
 * never letting a forged id label a tenant's events. The Supabase
 * admin client is stubbed; rate limiting runs for real.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let inserts: Array<{ table: string; rows: unknown }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? { data: null, error: null };
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        update: () => builder,
        insert: (rows: unknown) => {
          inserts.push({ table, rows });
          return Promise.resolve({ error: null });
        },
        maybeSingle: () => Promise.resolve(response),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve({ error: null }).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown,
          ),
      };
      return builder;
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { POST } = await import('./route');

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHARE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let sessionCounter = 0;

function beacon(extra: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/public/showcase-events', {
    method: 'POST',
    body: JSON.stringify({
      account_id: ACCOUNT,
      // Unique per test — the rate limiter is keyed on session and its
      // state is module-global, so a shared key would bleed budgets.
      session_key: `sess-${++sessionCounter}`,
      events: [{ type: 'open' }],
      ...extra,
    }),
  }) as never;
}

function insertedEvents(): Array<{ share_id: string | null }> {
  const batch = inserts.find((i) => i.table === 'showcase_events');
  return (batch?.rows ?? []) as Array<{ share_id: string | null }>;
}

beforeEach(() => {
  queues = { accounts: [{ data: { id: ACCOUNT }, error: null }] };
  inserts = [];
});

describe('showcase-events beacon — share-instance stamping', () => {
  it('stamps events with a share id that belongs to the account', async () => {
    queues.showcase_share_links = [{ data: { id: SHARE }, error: null }];

    const res = await POST(beacon({ share_id: SHARE }));

    expect(res.status).toBe(204);
    expect(insertedEvents()).toHaveLength(1);
    expect(insertedEvents()[0].share_id).toBe(SHARE);
  });

  it("drops a share id that doesn't resolve within the account", async () => {
    queues.showcase_share_links = [{ data: null, error: null }];

    const res = await POST(beacon({ share_id: SHARE }));

    expect(res.status).toBe(204);
    expect(insertedEvents()).toHaveLength(1);
    expect(insertedEvents()[0].share_id).toBeNull();
  });

  it('ignores a non-UUID share id without a lookup', async () => {
    const res = await POST(beacon({ share_id: 'not-a-uuid' }));

    expect(res.status).toBe(204);
    expect(insertedEvents()).toHaveLength(1);
    expect(insertedEvents()[0].share_id).toBeNull();
  });

  it('inserts with a null share id when none is sent', async () => {
    const res = await POST(beacon());

    expect(res.status).toBe(204);
    expect(insertedEvents()).toHaveLength(1);
    expect(insertedEvents()[0].share_id).toBeNull();
  });
});
