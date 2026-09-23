import { beforeEach, describe, it, expect, vi } from 'vitest';

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  send: vi.fn(),
  lease: 'run' as 'run' | 'busy' | 'lookup_failed',
  beforeRun: null as (() => void) | null,
  leased: [] as string[],
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) => h.send(...args),
}));

vi.mock('@/lib/conversations/outbound-lease', () => ({
  withContactConversationLease: async (
    _db: unknown,
    _accountId: string,
    contactId: string,
    run: () => Promise<unknown>
  ) => {
    h.leased.push(contactId);
    if (h.lease !== 'run') return { status: h.lease };
    h.beforeRun?.();
    return { status: 'ran', value: await run() };
  },
}));

import {
  processShareFeedbackFollowups,
  SHARE_FEEDBACK_CLAIM_STALE_MS,
} from './share-feedback';

const ACCOUNT_ID = 'acc-1';
const CONTACT_ID = 'contact-1';
const SHARE_ID = 'share-1';
const SHARE_CREATED_AT = new Date(Date.now() - 45 * 60 * 1000).toISOString();

function matchesOr(row: Row, expr: string): boolean {
  return expr.split(',').some((clause) => {
    const [column, op, ...rest] = clause.split('.');
    const value = rest.join('.');
    if (op === 'is' && value === 'null') return row[column] == null;
    if (op === 'lt') return row[column] != null && String(row[column]) < value;
    return false;
  });
}

function makeDb(
  opts: {
    lastCustomerMessageAt?: string | null;
    share?: Row;
  } = {}
) {
  const state = {
    lastCustomerMessageAt: opts.lastCustomerMessageAt,
    shares: [
      {
        id: SHARE_ID,
        account_id: ACCOUNT_ID,
        contact_id: CONTACT_ID,
        created_at: SHARE_CREATED_AT,
        recipient_kind: 'buyer',
        feedback_status: 'pending',
        feedback_sent_at: null,
        contacts: { id: CONTACT_ID, name: 'Asha' },
        ...opts.share,
      } as Row,
    ],
  };

  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    const ors: string[] = [];
    let patch: Row | null = null;
    const applyPatch = () => {
      const rows = state.shares.filter(
        (r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v) &&
          ors.every((expr) => matchesOr(r, expr))
      );
      for (const r of rows) Object.assign(r, patch);
      return rows;
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return b;
      },
      or: (expr: string) => {
        ors.push(expr);
        return b;
      },
      in: () => b,
      lte: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      update: (payload: Row) => {
        patch = payload;
        return b;
      },
      maybeSingle: async () => {
        if (table === 'property_shares' && patch) {
          const rows = applyPatch();
          return { data: rows[0] ? { id: rows[0].id } : null, error: null };
        }
        if (table === 'conversations') {
          return {
            data:
              state.lastCustomerMessageAt === undefined
                ? null
                : { last_customer_message_at: state.lastCustomerMessageAt },
            error: null,
          };
        }
        if (table === 'whatsapp_config') {
          return { data: { user_id: 'owner-1' }, error: null };
        }
        if (table === 'contacts') {
          return {
            data: { name: 'Asha', preferred_language: 'en_US' },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
        if (table === 'property_shares') {
          if (patch) {
            applyPatch();
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve({
            data: state.shares
              .filter((r) => r.feedback_status === 'pending')
              .map((r) => ({ ...r })),
            error: null,
          }).then(resolve);
        }
        if (table === 'message_templates') {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return b;
  }

  return { from: (table: string) => builder(table), state };
}

beforeEach(() => {
  h.send.mockReset();
  h.send.mockResolvedValue({ success: true });
  h.lease = 'run';
  h.beforeRun = null;
  h.leased = [];
});

describe('processShareFeedbackFollowups', () => {
  it('never queries messages.contact_id/direction and sends when the buyer never replied', async () => {
    const db = makeDb({ lastCustomerMessageAt: null });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(db.state.shares[0].feedback_status).toBe('sent');
  });

  it('skips the share once the buyer has replied since it was created', async () => {
    const db = makeDb({
      lastCustomerMessageAt: new Date(
        Date.now() - 10 * 60 * 1000
      ).toISOString(),
    });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0]).toMatchObject({
      feedback_status: 'skipped',
      feedback_sent_at: null,
    });
  });

  it('[INB-018] sends under the buyer conversation lease', async () => {
    const db = makeDb({ lastCustomerMessageAt: null });

    await processShareFeedbackFollowups(db as never);

    expect(h.leased).toEqual([CONTACT_ID]);
  });

  it('[INB-018] a busy conversation leaves the share pending and unclaimed for the next run', async () => {
    h.lease = 'busy';
    const db = makeDb({ lastCustomerMessageAt: null });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0]).toMatchObject({
      feedback_status: 'pending',
      feedback_sent_at: null,
    });

    h.lease = 'run';
    expect(await processShareFeedbackFollowups(db as never)).toBe(1);
  });

  it('[INB-018] a failed conversation lookup releases the share instead of sending unlocked', async () => {
    h.lease = 'lookup_failed';
    const db = makeDb({ lastCustomerMessageAt: null });

    expect(await processShareFeedbackFollowups(db as never)).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0].feedback_sent_at).toBeNull();
  });

  it('[INB-018] a reply that lands while it waits for the lease skips the share', async () => {
    const db = makeDb({ lastCustomerMessageAt: null });
    h.beforeRun = () => {
      db.state.lastCustomerMessageAt = new Date().toISOString();
    };

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0].feedback_status).toBe('skipped');
  });

  it('[INB-018] a share another run has claimed is not sent twice', async () => {
    const db = makeDb({
      lastCustomerMessageAt: null,
      share: { feedback_sent_at: new Date().toISOString() },
    });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.leased).toEqual([]);
  });

  it('[INB-018] a claim left by a run that died is taken over once it is stale', async () => {
    const db = makeDb({
      lastCustomerMessageAt: null,
      share: {
        feedback_sent_at: new Date(
          Date.now() - SHARE_FEEDBACK_CLAIM_STALE_MS - 60_000
        ).toISOString(),
      },
    });

    expect(await processShareFeedbackFollowups(db as never)).toBe(1);
  });

  it('[INB-018] a send Meta refuses releases the share rather than marking it sent', async () => {
    h.send.mockResolvedValue({ success: false, error: 'rate limited' });
    const db = makeDb({ lastCustomerMessageAt: null });

    expect(await processShareFeedbackFollowups(db as never)).toBe(0);
    expect(db.state.shares[0]).toMatchObject({
      feedback_status: 'pending',
      feedback_sent_at: null,
    });
  });
});
