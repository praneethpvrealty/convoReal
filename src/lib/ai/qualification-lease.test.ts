import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Lease {
  holder: string;
  expiresAt: number;
  pending: string[];
}

let leases = new Map<string, Lease>();
let payloads = new Map<string, unknown>();
let failing = new Set<string>();
let adminThrows = false;
let calls: string[] = [];

const live = (lease?: Lease) => !!lease && lease.expiresAt > Date.now();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    if (adminThrows) throw new Error('no service role');
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        await Promise.resolve();
        calls.push(fn);
        if (failing.has(fn)) return { data: null, error: { message: fn } };
        const key = args.p_conversation_id as string;
        const lease = leases.get(key);
        const ttl = (args.p_ttl_seconds as number) * 1000;
        switch (fn) {
          case 'claim_conversation_qualification_lease':
            if (live(lease)) return { data: false, error: null };
            leases.set(key, {
              holder: args.p_holder as string,
              expiresAt: Date.now() + ttl,
              pending: lease?.pending ?? [],
            });
            return { data: true, error: null };
          case 'renew_conversation_qualification_lease':
            if (!lease || lease.holder !== args.p_holder) {
              return { data: false, error: null };
            }
            lease.expiresAt = Date.now() + ttl;
            return { data: true, error: null };
          case 'defer_conversation_message':
            if (!lease || !live(lease)) return { data: false, error: null };
            if (!lease.pending.includes(args.p_message_id as string)) {
              lease.pending.push(args.p_message_id as string);
            }
            payloads.set(`${key}:${args.p_message_id}`, args.p_payload);
            return { data: true, error: null };
          case 'defer_conversation_qualification':
            if (!lease || !live(lease)) return { data: false, error: null };
            if (!lease.pending.includes(args.p_message_id as string)) {
              lease.pending.push(args.p_message_id as string);
            }
            return { data: true, error: null };
          case 'finish_conversation_qualification_lease': {
            if (!lease || lease.holder !== args.p_holder)
              return { data: [], error: null };
            const pending = lease.pending;
            if (pending.length > 0) {
              lease.pending = [];
              lease.expiresAt = Date.now() + ttl;
              return { data: pending, error: null };
            }
            leases.delete(key);
            return { data: [], error: null };
          }
        }
        return { data: null, error: { message: `unknown ${fn}` } };
      },
      from: (table: string) => {
        const filters: Record<string, unknown> = {};
        let patch: Record<string, unknown> | null = null;
        const chain = {
          delete: () => chain,
          update: (values: Record<string, unknown>) => {
            patch = values;
            return chain;
          },
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          select: () => chain,
          maybeSingle: async () => {
            const key = `${filters.conversation_id}:${filters.message_id}`;
            calls.push(`take ${table}`);
            if (!payloads.has(key)) return { data: null, error: null };
            const payload = payloads.get(key);
            payloads.delete(key);
            return { data: { payload }, error: null };
          },
          then: (resolve: (v: unknown) => unknown) => {
            const key = filters.conversation_id as string;
            const lease = leases.get(key);
            if (patch) {
              if (lease && lease.holder === filters.holder) {
                lease.expiresAt = Date.parse(patch.expires_at as string);
              }
              calls.push('expire');
            } else {
              if (lease?.holder === filters.holder) leases.delete(key);
              calls.push('delete');
            }
            return Promise.resolve(resolve({ error: null }));
          },
        };
        return chain;
      },
    };
  },
}));

const {
  withConversationLease,
  takeDeferredMessage,
  QualificationLeaseBusyError,
} = await import('./qualification-lease');

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  leases = new Map();
  payloads = new Map();
  failing = new Set();
  adminThrows = false;
  calls = [];
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
      return true;
    };

    await Promise.all([
      withConversationLease(
        'acct-1',
        'conv-1',
        'wamid.1',
        fileLine('1200 sqft'),
        {
          pollMs: 5,
        }
      ),
      withConversationLease(
        'acct-1',
        'conv-1',
        'wamid.2',
        fileLine('30 lakh'),
        {
          pollMs: 5,
        }
      ),
    ]);

    expect(events).toEqual([
      'start 1200 sqft',
      'end 1200 sqft',
      'start 30 lakh',
      'end 30 lakh',
    ]);
    expect(brief).toBe('1200 sqft\n30 lakh');
    expect(leases.size).toBe(0);
  });

  it('[INB-014] renews a long run so a waiter keeps waiting instead of taking the lease over', async () => {
    const events: string[] = [];
    const options = {
      ttlSeconds: 0.04,
      renewEveryMs: 10,
      pollMs: 5,
      waitMs: 1_000,
    };
    const long = withConversationLease(
      'acct-1',
      'conv-1',
      'wamid.1',
      async () => {
        events.push('start long');
        await tick(150);
        events.push('end long');
        return true;
      },
      options
    );
    await tick(5);
    const waiter = withConversationLease(
      'acct-1',
      'conv-1',
      'wamid.2',
      async () => {
        events.push('start waiter');
        return true;
      },
      options
    );
    await Promise.all([long, waiter]);

    expect(events).toEqual(['start long', 'end long', 'start waiter']);
    expect(
      calls.filter((c) => c === 'renew_conversation_qualification_lease').length
    ).toBeGreaterThan(3);
  });

  it('[INB-014] hands a message to the holder once the wait is capped, never running it unlocked', async () => {
    const events: string[] = [];
    const run = async (id: string | null) => {
      events.push(`start ${id}`);
      await tick(id === 'wamid.1' ? 60 : 1);
      events.push(`end ${id}`);
      return true;
    };
    const holder = withConversationLease('acct-1', 'conv-1', 'wamid.1', run, {
      pollMs: 5,
    });
    await tick(5);
    const deferred = await withConversationLease(
      'acct-1',
      'conv-1',
      'wamid.2',
      run,
      { pollMs: 5, waitMs: 10 }
    );
    expect(deferred).toBe(true);
    expect(events).toEqual(['start wamid.1']);

    await holder;
    expect(events).toEqual([
      'start wamid.1',
      'end wamid.1',
      'start wamid.2',
      'end wamid.2',
    ]);
    expect(leases.size).toBe(0);
  });

  it('[INB-014] raises the retryable busy error when a live lease cannot take the message', async () => {
    leases.set('conv-1', {
      holder: 'other',
      expiresAt: Date.now() + 60_000,
      pending: [],
    });
    failing.add('defer_conversation_qualification');
    const run = vi.fn(async () => true);
    const sleep = vi.fn(async () => {});

    await expect(
      withConversationLease('acct-1', 'conv-1', 'wamid.2', run, {
        waitMs: 0,
        sleep,
      })
    ).rejects.toBeInstanceOf(QualificationLeaseBusyError);
    await expect(
      withConversationLease('acct-1', 'conv-1', null, run, {
        waitMs: 0,
        sleep,
      })
    ).rejects.toBeInstanceOf(QualificationLeaseBusyError);
    expect(run).not.toHaveBeenCalled();
    expect(leases.get('conv-1')?.holder).toBe('other');
  });

  it('takes over a crashed holder once its lease expires, and runs what was left with it', async () => {
    leases.set('conv-1', {
      holder: 'crashed',
      expiresAt: Date.now() - 1,
      pending: ['wamid.0'],
    });
    const ran: (string | null)[] = [];
    await withConversationLease('acct-1', 'conv-1', 'wamid.1', async (id) => {
      ran.push(id);
      return true;
    });
    expect(ran).toEqual(['wamid.1', 'wamid.0']);
    expect(leases.size).toBe(0);
  });

  it('does not hold one conversation up behind another', async () => {
    const events: string[] = [];
    const step = (name: string) => async () => {
      events.push(`start ${name}`);
      await tick(20);
      events.push(`end ${name}`);
      return true;
    };
    await Promise.all([
      withConversationLease('acct-1', 'conv-1', 'a', step('a'), { pollMs: 5 }),
      withConversationLease('acct-1', 'conv-2', 'b', step('b'), { pollMs: 5 }),
    ]);
    expect(events.slice(0, 2)).toEqual(['start a', 'start b']);
  });

  it('[INB-016] treats a claim that keeps erroring as busy, never running unlocked', async () => {
    failing.add('claim_conversation_qualification_lease');
    const run = vi.fn(async () => true);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    await expect(
      withConversationLease('acct-1', 'conv-1', 'wamid.1', run, { sleep })
    ).rejects.toBeInstanceOf(QualificationLeaseBusyError);
    expect(run).not.toHaveBeenCalled();
    expect(
      calls.filter((c) => c === 'claim_conversation_qualification_lease')
    ).toHaveLength(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500, 1000]);
    expect(calls).not.toContain('defer_conversation_message');
    expect(calls).not.toContain('finish_conversation_qualification_lease');
  });

  it('[INB-016] retries a claim that errors once and then runs under the lease', async () => {
    let failures = 1;
    failing.add('claim_conversation_qualification_lease');
    const sleep = vi.fn(async () => {
      if (--failures === 0)
        failing.delete('claim_conversation_qualification_lease');
    });
    const run = vi.fn(async () => {
      expect(leases.has('conv-1')).toBe(true);
      return true;
    });
    await expect(
      withConversationLease('acct-1', 'conv-1', 'wamid.1', run, { sleep })
    ).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith('wamid.1', { waited: false });
    expect(leases.size).toBe(0);
  });

  it('[INB-016] treats a missing client as busy rather than running unlocked', async () => {
    adminThrows = true;
    const run = vi.fn(async () => true);
    await expect(
      withConversationLease('acct-1', 'conv-1', 'wamid.1', run)
    ).rejects.toBeInstanceOf(QualificationLeaseBusyError);
    expect(run).not.toHaveBeenCalled();
  });

  it('releases the lease when the work throws', async () => {
    await expect(
      withConversationLease('acct-1', 'conv-1', 'wamid.1', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(leases.size).toBe(0);
  });

  it('[INB-016] lets the lease expire with its pending ids when finishing fails, never deleting it', async () => {
    failing.add('finish_conversation_qualification_lease');
    await withConversationLease('acct-1', 'conv-1', 'wamid.1', async () => {
      leases.get('conv-1')!.pending.push('wamid.2');
      return true;
    });
    expect(calls).toContain('expire');
    expect(calls).not.toContain('delete');
    expect(leases.get('conv-1')).toMatchObject({ pending: ['wamid.2'] });
    expect(live(leases.get('conv-1'))).toBe(false);
  });

  it('[INB-016] a message deferred during the last drain round is left for the next holder, which runs it and clears its payload', async () => {
    const ran: (string | null)[] = [];
    const taken: unknown[] = [];
    const first = withConversationLease(
      'acct-1',
      'conv-1',
      'wamid.1',
      async (id) => {
        ran.push(id);
        if (id === 'wamid.1') await tick(40);
        if (id === 'wamid.2') {
          taken.push(await takeDeferredMessage('acct-1', 'conv-1', id));
          await withConversationLease(
            'acct-1',
            'conv-1',
            'wamid.3',
            async () => true,
            { waitMs: 0, deferPayload: { text: 'third' } }
          );
        }
        return true;
      },
      { pollMs: 5, maxDeferredRounds: 1 }
    );
    await tick(5);
    await withConversationLease(
      'acct-1',
      'conv-1',
      'wamid.2',
      async () => true,
      {
        pollMs: 5,
        waitMs: 10,
        deferPayload: { text: 'second' },
      }
    );
    await first;

    expect(ran).toEqual(['wamid.1', 'wamid.2']);
    expect(calls).not.toContain('delete');
    expect(leases.get('conv-1')).toMatchObject({ pending: ['wamid.3'] });
    expect(live(leases.get('conv-1'))).toBe(false);
    expect(payloads.has('conv-1:wamid.3')).toBe(true);

    await withConversationLease('acct-1', 'conv-1', 'wamid.4', async (id) => {
      ran.push(id);
      if (id !== 'wamid.4') {
        taken.push(await takeDeferredMessage('acct-1', 'conv-1', id!));
      }
      return true;
    });

    expect(ran).toEqual(['wamid.1', 'wamid.2', 'wamid.4', 'wamid.3']);
    expect(taken).toEqual([{ text: 'second' }, { text: 'third' }]);
    expect(payloads.size).toBe(0);
    expect(leases.size).toBe(0);
  });

  it('[INB-016] a non-draining holder leaves deferred ids on an expired lease instead of running them', async () => {
    leases.set('conv-1', {
      holder: 'crashed',
      expiresAt: Date.now() - 1,
      pending: ['wamid.0'],
    });
    const ran: (string | null)[] = [];
    await withConversationLease(
      'acct-1',
      'conv-1',
      null,
      async (id) => {
        ran.push(id);
        return true;
      },
      { waitMs: 0, drainDeferred: false }
    );
    expect(ran).toEqual([null]);
    expect(calls).not.toContain('finish_conversation_qualification_lease');
    expect(leases.get('conv-1')).toMatchObject({ pending: ['wamid.0'] });
    expect(live(leases.get('conv-1'))).toBe(false);
  });

  it('[INB-016] tells a run whether it waited for another holder', async () => {
    const seen: [string | null, boolean][] = [];
    const run = async (id: string | null, info: { waited: boolean }) => {
      seen.push([id, info.waited]);
      await tick(20);
      return true;
    };
    await Promise.all([
      withConversationLease('acct-1', 'conv-1', 'wamid.1', run, { pollMs: 5 }),
      tick(5).then(() =>
        withConversationLease('acct-1', 'conv-1', 'wamid.2', run, {
          pollMs: 5,
        })
      ),
    ]);
    expect(seen).toEqual([
      ['wamid.1', false],
      ['wamid.2', true],
    ]);
  });

  it('[INB-016] hands the holder the deferred payload with the id, and the holder takes it exactly once', async () => {
    const run = async (id: string | null) => {
      await tick(id === 'wamid.1' ? 60 : 1);
      return true;
    };
    const taken: unknown[] = [];
    const holder = withConversationLease(
      'acct-1',
      'conv-1',
      'wamid.1',
      async (id) => {
        if (id !== 'wamid.1') {
          taken.push(await takeDeferredMessage('acct-1', 'conv-1', id!));
          taken.push(await takeDeferredMessage('acct-1', 'conv-1', id!));
          return true;
        }
        return run(id);
      },
      { pollMs: 5 }
    );
    await tick(5);
    await withConversationLease('acct-1', 'conv-1', 'wamid.2', run, {
      pollMs: 5,
      waitMs: 10,
      deferPayload: { text: 'Rent' },
    });
    await holder;

    expect(calls).toContain('defer_conversation_message');
    expect(calls).not.toContain('defer_conversation_qualification');
    expect(taken).toEqual([{ text: 'Rent' }, null]);
    expect(leases.size).toBe(0);
  });

  it('[INB-016] still hands over the id alone when the payload cannot be stored', async () => {
    failing.add('defer_conversation_message');
    const ran: (string | null)[] = [];
    const holder = withConversationLease(
      'acct-1',
      'conv-1',
      'wamid.1',
      async (id) => {
        ran.push(id);
        await tick(id === 'wamid.1' ? 60 : 1);
        return true;
      },
      { pollMs: 5 }
    );
    await tick(5);
    await expect(
      withConversationLease('acct-1', 'conv-1', 'wamid.2', async () => true, {
        pollMs: 5,
        waitMs: 10,
        deferPayload: { text: 'Rent' },
      })
    ).resolves.toBe(true);
    await holder;

    expect(calls).toContain('defer_conversation_qualification');
    expect(ran).toEqual(['wamid.1', 'wamid.2']);
  });
});
