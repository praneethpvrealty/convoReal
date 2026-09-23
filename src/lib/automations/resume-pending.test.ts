import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Row {
  id: string;
  automation_id: string;
  account_id: string;
  user_id: string;
  contact_id: string | null;
  log_id: string | null;
  parent_step_id: string | null;
  branch: null;
  next_step_position: number;
  context: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  run_at: number;
  claimed_at: number | null;
  claim_token: string | null;
  attempts: number;
}

interface Lease {
  holder: string;
  expiresAt: number;
}

const h = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  leases: new Map<string, Lease>(),
  conversations: new Map<string, string>(),
  resumed: [] as { id: string; token: string | null | undefined }[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  tokenSeq: 0,
}));

const ACCOUNT = 'acct-1';
const MINUTE = 60_000;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      await Promise.resolve();
      h.rpcCalls.push({ fn, args });
      const now = Date.now();
      switch (fn) {
        case 'claim_automation_pending_executions': {
          const staleBefore = now - (args.p_stale_seconds as number) * 1000;
          const max = args.p_max_attempts as number;
          const isStale = (r: Row) =>
            r.status === 'running' &&
            (r.claimed_at === null || r.claimed_at < staleBefore);
          for (const r of h.rows.values()) {
            if (isStale(r) && r.attempts >= max) {
              r.status = 'failed';
              r.claim_token = null;
            }
          }
          const due = [...h.rows.values()]
            .filter(
              (r) =>
                (r.status === 'pending' && r.run_at <= now) ||
                (isStale(r) && r.attempts < max)
            )
            .sort((a, b) => a.run_at - b.run_at)
            .slice(0, args.p_limit as number);
          for (const r of due) {
            r.status = 'running';
            r.claimed_at = now;
            r.claim_token = `token-${++h.tokenSeq}`;
            r.attempts++;
          }
          return { data: due.map((r) => ({ ...r })), error: null };
        }
        case 'release_automation_pending_execution': {
          const r = h.rows.get(args.p_id as string);
          if (
            !r ||
            r.status !== 'running' ||
            r.claim_token !== args.p_claim_token
          ) {
            return { data: false, error: null };
          }
          r.status = 'pending';
          r.claimed_at = null;
          r.claim_token = null;
          r.attempts = Math.max(r.attempts - 1, 0);
          return { data: true, error: null };
        }
        case 'claim_conversation_qualification_lease': {
          const key = args.p_conversation_id as string;
          const lease = h.leases.get(key);
          if (lease && lease.expiresAt > now)
            return { data: false, error: null };
          h.leases.set(key, {
            holder: args.p_holder as string,
            expiresAt: now + (args.p_ttl_seconds as number) * 1000,
          });
          return { data: true, error: null };
        }
        case 'renew_conversation_qualification_lease':
          return { data: true, error: null };
        case 'finish_conversation_qualification_lease': {
          const key = args.p_conversation_id as string;
          if (h.leases.get(key)?.holder === args.p_holder) h.leases.delete(key);
          return { data: [], error: null };
        }
      }
      return { data: null, error: { message: `unknown ${fn}` } };
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        delete: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          if (table !== 'conversations') return { data: null, error: null };
          const id =
            filters.account_id === ACCOUNT
              ? h.conversations.get(filters.contact_id as string)
              : undefined;
          return { data: id ? { id } : null, error: null };
        },
      };
      return chain;
    },
  }),
}));

vi.mock('./engine', () => ({
  resumePendingExecution: vi.fn(
    async (pending: { id: string; claim_token?: string | null }) => {
      h.resumed.push({ id: pending.id, token: pending.claim_token });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const row = h.rows.get(pending.id);
      if (row && row.claim_token === pending.claim_token) row.status = 'done';
    }
  ),
}));

import {
  drainPendingExecutions,
  RESUME_MAX_ATTEMPTS,
  RESUME_STALE_SECONDS,
} from './resume-pending';

function addRow(
  id: string,
  contactId: string | null,
  overrides: Partial<Row> = {}
): Row {
  const row: Row = {
    id,
    automation_id: 'auto-1',
    account_id: ACCOUNT,
    user_id: 'user-1',
    contact_id: contactId,
    log_id: null,
    parent_step_id: null,
    branch: null,
    next_step_position: 2,
    context: {},
    status: 'pending',
    run_at: Date.now() - MINUTE,
    claimed_at: null,
    claim_token: null,
    attempts: 0,
    ...overrides,
  };
  h.rows.set(id, row);
  return row;
}

function holdLease(conversationId: string) {
  h.leases.set(conversationId, {
    holder: 'inbound-chain',
    expiresAt: Date.now() + 30_000,
  });
}

beforeEach(() => {
  h.rows.clear();
  h.leases.clear();
  h.conversations.clear();
  h.resumed = [];
  h.rpcCalls = [];
  h.tokenSeq = 0;
  h.conversations.set('contact-a', 'conv-a');
  h.conversations.set('contact-b', 'conv-b');
});

describe('drainPendingExecutions', () => {
  it('[INB-017] two overlapping cron runs execute each pending row once', async () => {
    addRow('p1', 'contact-a');
    addRow('p2', 'contact-b');
    addRow('p3', 'contact-a', { run_at: Date.now() + MINUTE });

    const [first, second] = await Promise.all([
      drainPendingExecutions(),
      drainPendingExecutions(),
    ]);

    expect(h.resumed.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    expect(first.processed + second.processed).toBe(2);
    expect(h.rows.get('p1')?.status).toBe('done');
    expect(h.rows.get('p2')?.status).toBe('done');
    expect(h.rows.get('p3')?.status).toBe('pending');

    await drainPendingExecutions();
    expect(h.resumed).toHaveLength(2);
  });

  it('[INB-017] a resume skips while the conversation lease is live and is retried next tick', async () => {
    addRow('p1', 'contact-a');
    holdLease('conv-a');

    const busy = await drainPendingExecutions();

    expect(busy).toEqual({ processed: 0, deferred: 1 });
    expect(h.resumed).toHaveLength(0);
    expect(h.rows.get('p1')).toMatchObject({
      status: 'pending',
      claim_token: null,
      attempts: 0,
    });
    expect(h.leases.get('conv-a')?.holder).toBe('inbound-chain');

    h.leases.delete('conv-a');
    const retried = await drainPendingExecutions();

    expect(retried).toEqual({ processed: 1, deferred: 0 });
    expect(h.resumed.map((r) => r.id)).toEqual(['p1']);
    expect(h.rows.get('p1')?.status).toBe('done');
    expect(h.leases.has('conv-a')).toBe(false);
  });

  it('[INB-017] the resume holds the lease for its conversation, so an inbound chain waits for it', async () => {
    addRow('p1', 'contact-a');
    let heldDuringResume: string | undefined;
    const { resumePendingExecution } = await import('./engine');
    vi.mocked(resumePendingExecution).mockImplementationOnce(async (p) => {
      heldDuringResume = h.leases.get('conv-a')?.holder;
      h.resumed.push({ id: p.id, token: p.claim_token });
    });

    await drainPendingExecutions();

    expect(heldDuringResume).toBeDefined();
    expect(heldDuringResume).not.toBe('inbound-chain');
    const claim = h.rpcCalls.find(
      (c) => c.fn === 'claim_conversation_qualification_lease'
    );
    expect(claim?.args).toMatchObject({
      p_account_id: ACCOUNT,
      p_conversation_id: 'conv-a',
    });
    expect(claim?.args.p_ttl_seconds as number).toBeLessThan(30);
  });

  it('[INB-017] the context conversation is the one leased when the row carries it', async () => {
    addRow('p1', 'contact-a', { context: { conversation_id: 'conv-ctx' } });
    holdLease('conv-ctx');

    const result = await drainPendingExecutions();

    expect(result.deferred).toBe(1);
    expect(h.resumed).toHaveLength(0);
  });

  it('[INB-017] a stuck running row is recovered after the timeout, and given up after the attempt cap', async () => {
    const stale = Date.now() - (RESUME_STALE_SECONDS + 60) * 1000;
    addRow('stuck', 'contact-a', {
      status: 'running',
      claimed_at: stale,
      claim_token: 'dead-invocation',
      attempts: 1,
    });
    addRow('exhausted', 'contact-b', {
      status: 'running',
      claimed_at: stale,
      claim_token: 'dead-invocation',
      attempts: RESUME_MAX_ATTEMPTS,
    });
    addRow('in-flight', 'contact-b', {
      status: 'running',
      claimed_at: Date.now() - MINUTE,
      claim_token: 'live-invocation',
      attempts: 1,
    });

    const result = await drainPendingExecutions();

    expect(result.processed).toBe(1);
    expect(h.resumed).toHaveLength(1);
    expect(h.resumed[0].id).toBe('stuck');
    expect(h.resumed[0].token).not.toBe('dead-invocation');
    expect(h.rows.get('stuck')).toMatchObject({ status: 'done', attempts: 2 });
    expect(h.rows.get('exhausted')?.status).toBe('failed');
    expect(h.rows.get('in-flight')).toMatchObject({
      status: 'running',
      claim_token: 'live-invocation',
    });
  });

  it('[INB-017] resumes for other conversations still proceed while one is busy', async () => {
    addRow('p1', 'contact-a');
    addRow('p2', 'contact-b');
    holdLease('conv-a');

    const result = await drainPendingExecutions();

    expect(result).toEqual({ processed: 1, deferred: 1 });
    expect(h.resumed.map((r) => r.id)).toEqual(['p2']);
    expect(h.rows.get('p1')?.status).toBe('pending');
    expect(h.rows.get('p2')?.status).toBe('done');
  });

  it('[INB-017] a resume with no conversation runs without a lease', async () => {
    addRow('no-contact', null);
    addRow('no-thread', 'contact-without-conversation');

    const result = await drainPendingExecutions();

    expect(result.processed).toBe(2);
    expect(h.resumed.map((r) => r.id).sort()).toEqual([
      'no-contact',
      'no-thread',
    ]);
    expect(
      h.rpcCalls.some((c) => c.fn === 'claim_conversation_qualification_lease')
    ).toBe(false);
  });

  it('[INB-017] keeps each invocation bounded by its claim limit', async () => {
    for (let i = 0; i < 5; i++) addRow(`p${i}`, null);

    const result = await drainPendingExecutions(3);

    expect(result.processed).toBe(3);
    expect(
      [...h.rows.values()].filter((r) => r.status === 'pending')
    ).toHaveLength(2);
  });
});
