import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  send: vi.fn(),
  lease: 'run' as 'run' | 'busy' | 'lookup_failed',
  leaseCalls: [] as { contactId: string; waitMs?: number }[],
  conversationError: null as unknown,
  lastCustomerMessageAt: null as string | null,
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) => h.send(...args),
}));

vi.mock('@/lib/conversations/outbound-lease', () => ({
  withContactConversationLease: async (
    _db: unknown,
    _accountId: string,
    contactId: string,
    run: () => Promise<unknown>,
    opts: { waitMs?: number } = {}
  ) => {
    h.leaseCalls.push({ contactId, waitMs: opts.waitMs });
    if (h.lease !== 'run') return { status: h.lease };
    return { status: 'ran', value: await run() };
  },
}));

function matchesOr(row: Row, expr: string): boolean {
  return expr.split(',').some((clause) => {
    const [column, op, ...rest] = clause.split('.');
    const value = rest.join('.');
    if (op === 'is' && value === 'null') return row[column] == null;
    if (op === 'lte')
      return row[column] != null && String(row[column]) <= value;
    return false;
  });
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => fakeAdmin(),
}));

function fakeAdmin() {
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const ors: string[] = [];
      let patch: Row | null = null;
      const matching = () =>
        h.rows.filter(
          (r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v) &&
            ors.every((expr) => matchesOr(r, expr))
        );
      const apply = () => {
        const rows = matching();
        for (const r of rows) Object.assign(r, patch);
        return rows;
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (values: Row) => {
          patch = values;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        or: (expr: string) => {
          ors.push(expr);
          return chain;
        },
        not: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === 'outreach_followups') {
            const rows = patch ? apply() : matching();
            return { data: rows[0] ? { id: rows[0].id } : null, error: null };
          }
          if (table === 'contacts') {
            return {
              data: {
                id: 'contact-1',
                name: 'Asha',
                phone: '919800000001',
                do_not_call: false,
                is_merged: false,
              },
              error: null,
            };
          }
          if (table === 'conversations') {
            if (h.conversationError) {
              return { data: null, error: h.conversationError };
            }
            return {
              data: { last_customer_message_at: h.lastCustomerMessageAt },
              error: null,
            };
          }
          if (table === 'profiles') {
            return { data: { user_id: 'owner-1' }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (table === 'outreach_followups') {
            if (patch) {
              apply();
              return Promise.resolve({ data: [], error: null }).then(resolve);
            }
            return Promise.resolve({
              data: h.rows
                .filter(
                  (r) =>
                    r.status === 'pending' &&
                    r.scheduled_for != null &&
                    String(r.scheduled_for) <= new Date().toISOString()
                )
                .map((r) => ({ ...r })),
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}

import {
  OUTREACH_IMMEDIATE_WAIT_MS,
  sendPendingFollowUp,
  sweepDueOutreachFollowups,
  type OutreachFollowupRow,
} from '@/lib/outreach/dispatcher';

const DUE_AT = new Date(Date.now() - 60_000).toISOString();

function addRow(overrides: Row = {}): OutreachFollowupRow {
  const row = {
    id: 'f-1',
    account_id: 'acct-1',
    contact_id: 'contact-1',
    action: 'note',
    disposition: 'not_interested',
    status: 'pending',
    context: null,
    scheduled_for: DUE_AT,
    ...overrides,
  };
  h.rows.push(row);
  return { ...row } as unknown as OutreachFollowupRow;
}

beforeEach(() => {
  h.rows = [];
  h.send.mockReset();
  h.send.mockResolvedValue({ success: true });
  h.lease = 'run';
  h.leaseCalls = [];
  h.conversationError = null;
  h.lastCustomerMessageAt = new Date().toISOString();
});

describe('sendPendingFollowUp', () => {
  it('[INB-018] sends under the lead conversation lease and keeps the row schedule', async () => {
    const followup = addRow();

    const outcome = await sendPendingFollowUp(
      fakeAdmin() as never,
      followup,
      'owner-1'
    );

    expect(outcome).toBe('completed');
    expect(h.leaseCalls).toEqual([{ contactId: 'contact-1', waitMs: 0 }]);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.rows[0]).toMatchObject({
      status: 'completed',
      scheduled_for: DUE_AT,
    });
  });

  it('[INB-018] a busy conversation defers the row and leaves it due for the next sweep', async () => {
    h.lease = 'busy';
    const followup = addRow();

    const outcome = await sendPendingFollowUp(
      fakeAdmin() as never,
      followup,
      'owner-1'
    );

    expect(outcome).toBe('deferred');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.rows[0].status).toBe('pending');
    expect(String(h.rows[0].scheduled_for) <= new Date().toISOString()).toBe(
      true
    );
  });

  it('[INB-018] an immediate follow-up that cannot get the conversation becomes due for the sweep', async () => {
    h.lease = 'busy';
    const followup = addRow({ scheduled_for: null });

    const outcome = await sendPendingFollowUp(
      fakeAdmin() as never,
      followup,
      'owner-1',
      {
        waitMs: OUTREACH_IMMEDIATE_WAIT_MS,
      }
    );

    expect(outcome).toBe('deferred');
    expect(h.leaseCalls[0].waitMs).toBe(OUTREACH_IMMEDIATE_WAIT_MS);
    expect(h.rows[0].scheduled_for).not.toBeNull();

    h.lease = 'run';
    const summary = await sweepDueOutreachFollowups();
    expect(summary).toMatchObject({ due: 1, completed: 1 });
    expect(h.rows[0].status).toBe('completed');
  });

  it('[INB-018] a failed conversation lookup releases the row instead of sending unlocked', async () => {
    h.lease = 'lookup_failed';
    const followup = addRow();

    expect(
      await sendPendingFollowUp(fakeAdmin() as never, followup, 'owner-1')
    ).toBe('deferred');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.rows[0].status).toBe('pending');
  });

  it('[INB-018] a failed window check under the lease releases the row rather than failing it', async () => {
    h.conversationError = { message: 'timeout' };
    const followup = addRow();

    expect(
      await sendPendingFollowUp(fakeAdmin() as never, followup, 'owner-1')
    ).toBe('deferred');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.rows[0].status).toBe('pending');
    expect(String(h.rows[0].scheduled_for) <= new Date().toISOString()).toBe(
      true
    );
  });

  it('[INB-018] a row another run has claimed is not sent twice', async () => {
    const followup = addRow();
    h.rows[0].scheduled_for = new Date(Date.now() + 10 * 60_000).toISOString();

    const outcome = await sendPendingFollowUp(
      fakeAdmin() as never,
      followup,
      'owner-1'
    );

    expect(outcome).toBe('deferred');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.leaseCalls).toEqual([]);
  });
});

describe('sweepDueOutreachFollowups', () => {
  it('[INB-018] counts rows left for a busy conversation as deferred', async () => {
    h.lease = 'busy';
    addRow();

    const summary = await sweepDueOutreachFollowups();

    expect(summary).toMatchObject({ due: 1, deferred: 1, completed: 0 });
  });
});
