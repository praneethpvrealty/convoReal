import { describe, it, expect, vi, beforeEach } from 'vitest';

let leases = new Map<string, { holder: string; expiresAt: number }>();
let claimError: { message: string } | null = null;
let adminThrows = false;
let deletes = 0;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    if (adminThrows) throw new Error('no service role');
    return {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        await Promise.resolve();
        if (claimError) return { data: null, error: claimError };
        const key = args.p_conversation_id as string;
        const existing = leases.get(key);
        if (existing && existing.expiresAt > Date.now()) {
          return { data: false, error: null };
        }
        leases.set(key, {
          holder: args.p_holder as string,
          expiresAt: Date.now() + (args.p_ttl_seconds as number) * 1000,
        });
        return { data: true, error: null };
      },
      from: () => {
        const filters: Record<string, unknown> = {};
        const chain = {
          delete: () => chain,
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          then: (resolve: (v: unknown) => unknown) => {
            const key = filters.conversation_id as string;
            if (leases.get(key)?.holder === filters.holder) {
              leases.delete(key);
              deletes++;
            }
            return Promise.resolve(resolve({ error: null }));
          },
        };
        return chain;
      },
    };
  },
}));

const { withConversationLease } = await import('./qualification-lease');

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  leases = new Map();
  claimError = null;
  adminThrows = false;
  deletes = 0;
});

describe('withConversationLease', () => {
  it('[INB-014] runs overlapping calls on one conversation one at a time, the second seeing the first write', async () => {
    let brief = '';
    const events: string[] = [];
    const fileLine = (line: string) => async () => {
      events.push(`start ${line}`);
      const read = brief;
      await tick(20);
      brief = read ? `${read}\n${line}` : line;
      events.push(`end ${line}`);
      return brief;
    };

    const [first, second] = await Promise.all([
      withConversationLease('acct-1', 'conv-1', fileLine('1200 sqft'), {
        pollMs: 5,
      }),
      withConversationLease('acct-1', 'conv-1', fileLine('30 lakh'), {
        pollMs: 5,
      }),
    ]);

    expect(events).toEqual([
      'start 1200 sqft',
      'end 1200 sqft',
      'start 30 lakh',
      'end 30 lakh',
    ]);
    expect(first).toBe('1200 sqft');
    expect(second).toBe('1200 sqft\n30 lakh');
    expect(deletes).toBe(2);
    expect(leases.size).toBe(0);
  });

  it('does not hold one conversation up behind another', async () => {
    const events: string[] = [];
    const step = (name: string) => async () => {
      events.push(`start ${name}`);
      await tick(20);
      events.push(`end ${name}`);
    };
    await Promise.all([
      withConversationLease('acct-1', 'conv-1', step('a'), { pollMs: 5 }),
      withConversationLease('acct-1', 'conv-2', step('b'), { pollMs: 5 }),
    ]);
    expect(events.slice(0, 2)).toEqual(['start a', 'start b']);
  });

  it('proceeds without a lease when the claim errors', async () => {
    claimError = { message: 'function does not exist' };
    const run = vi.fn(async () => 'done');
    await expect(withConversationLease('acct-1', 'conv-1', run)).resolves.toBe(
      'done'
    );
    expect(deletes).toBe(0);
  });

  it('proceeds without a lease when the client cannot be built', async () => {
    adminThrows = true;
    await expect(
      withConversationLease('acct-1', 'conv-1', async () => 'done')
    ).resolves.toBe('done');
  });

  it('proceeds after waiting out a lease that is never released', async () => {
    leases.set('conv-1', { holder: 'stuck', expiresAt: Date.now() + 60_000 });
    const sleep = vi.fn(async () => {});
    await expect(
      withConversationLease('acct-1', 'conv-1', async () => 'done', {
        waitMs: 0,
        sleep,
      })
    ).resolves.toBe('done');
    expect(leases.get('conv-1')?.holder).toBe('stuck');
  });

  it('releases the lease when the work throws', async () => {
    await expect(
      withConversationLease('acct-1', 'conv-1', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(leases.size).toBe(0);
  });
});
