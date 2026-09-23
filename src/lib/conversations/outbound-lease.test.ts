import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  leases: new Map<string, { holder: string; expiresAt: number }>(),
  claimFails: false,
  claims: [] as { conversation: string; ttl: number }[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const now = Date.now();
      const key = args.p_conversation_id as string;
      if (fn === 'claim_conversation_qualification_lease') {
        if (h.claimFails) return { data: null, error: { message: 'down' } };
        h.claims.push({ conversation: key, ttl: args.p_ttl_seconds as number });
        const lease = h.leases.get(key);
        if (lease && lease.expiresAt > now) return { data: false, error: null };
        h.leases.set(key, {
          holder: args.p_holder as string,
          expiresAt: now + (args.p_ttl_seconds as number) * 1000,
        });
        return { data: true, error: null };
      }
      if (fn === 'renew_conversation_qualification_lease') {
        return { data: true, error: null };
      }
      if (fn === 'finish_conversation_qualification_lease') {
        if (h.leases.get(key)?.holder === args.p_holder) h.leases.delete(key);
        return { data: [], error: null };
      }
      return { data: null, error: { message: `unknown ${fn}` } };
    },
    from: () => {
      const filters: Record<string, unknown> = {};
      const chain = {
        update: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        then: (resolve: (v: unknown) => unknown) => {
          const lease = h.leases.get(filters.conversation_id as string);
          if (lease && lease.holder === filters.holder) lease.expiresAt = 0;
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return chain;
    },
  }),
}));

import {
  OUTBOUND_LEASE_TTL_SECONDS,
  withContactConversationLease,
} from './outbound-lease';

function lookupDb(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result,
  };
  return { from: () => chain } as never;
}

const withConversation = lookupDb({ data: { id: 'conv-1' }, error: null });

beforeEach(() => {
  h.leases.clear();
  h.claimFails = false;
  h.claims = [];
});

describe('withContactConversationLease', () => {
  it('[INB-018] runs under the contact conversation lease and leaves it free afterwards', async () => {
    let heldDuringRun = false;

    const result = await withContactConversationLease(
      withConversation,
      'acct-1',
      'contact-1',
      async () => {
        heldDuringRun = (h.leases.get('conv-1')?.expiresAt ?? 0) > Date.now();
        return 'sent';
      }
    );

    expect(result).toEqual({ status: 'ran', value: 'sent' });
    expect(heldDuringRun).toBe(true);
    expect(h.claims).toEqual([
      { conversation: 'conv-1', ttl: OUTBOUND_LEASE_TTL_SECONDS },
    ]);
    expect((h.leases.get('conv-1')?.expiresAt ?? 0) <= Date.now()).toBe(true);
  });

  it('[INB-018] does not run while an inbound chain holds the conversation', async () => {
    h.leases.set('conv-1', {
      holder: 'inbound',
      expiresAt: Date.now() + 30_000,
    });
    const run = vi.fn();

    const result = await withContactConversationLease(
      withConversation,
      'acct-1',
      'contact-1',
      run
    );

    expect(result).toEqual({ status: 'busy' });
    expect(run).not.toHaveBeenCalled();
    expect(h.leases.get('conv-1')?.holder).toBe('inbound');
  });

  it('[INB-018] waits for the holder when asked to, then runs', async () => {
    h.leases.set('conv-1', {
      holder: 'inbound',
      expiresAt: Date.now() + 300,
    });

    const result = await withContactConversationLease(
      withConversation,
      'acct-1',
      'contact-1',
      async () => 'sent',
      { waitMs: 2_000 }
    );

    expect(result).toEqual({ status: 'ran', value: 'sent' });
  });

  it('[INB-018] a lease claim that keeps erroring is busy, never unlocked', async () => {
    h.claimFails = true;
    const run = vi.fn();

    const result = await withContactConversationLease(
      withConversation,
      'acct-1',
      'contact-1',
      run
    );

    expect(result).toEqual({ status: 'busy' });
    expect(run).not.toHaveBeenCalled();
  });

  it('[INB-018] a failed conversation lookup does not run', async () => {
    const run = vi.fn();

    const result = await withContactConversationLease(
      lookupDb({ data: null, error: { message: 'timeout' } }),
      'acct-1',
      'contact-1',
      run
    );

    expect(result).toEqual({ status: 'lookup_failed' });
    expect(run).not.toHaveBeenCalled();
  });

  it('[INB-018] a contact with no conversation runs without a lease', async () => {
    const result = await withContactConversationLease(
      lookupDb({ data: null, error: null }),
      'acct-1',
      'contact-1',
      async () => 'sent'
    );

    expect(result).toEqual({ status: 'ran', value: 'sent' });
    expect(h.claims).toEqual([]);
  });
});
