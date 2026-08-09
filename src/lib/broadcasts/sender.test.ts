import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A recipient gets exactly one send.
 *
 * Three producers race for these rows — the fire-and-forget dispatch in
 * POST /api/broadcasts and the two cron routes that both call
 * sweepAndSendBroadcasts — and the sender used to mark a row 'sent'
 * only after the Meta round-trip returned. An overlapping sweep re-read
 * it as still pending and sent the same template again, which is how
 * two contacts received `listing_status_notice` twice and ended up with
 * two conversations each.
 */

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
let dispatchedTo: string[] = [];
/** Resolves when both sweeps have claimed, so neither runs to completion first. */
let releaseSend: (() => void) | null = null;

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(async (args: { toPhone: string }) => {
    dispatchedTo.push(args.toPhone);
    if (releaseSend) await new Promise<void>((r) => setTimeout(r, 5));
    return { success: true, whatsappMessageId: `wamid-${dispatchedTo.length}` };
  }),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => fakeDb(),
}));

/**
 * Enough of PostgREST to exercise the claim: filters accumulate, and an
 * UPDATE applies them at execution time — so a conditional status flip
 * sees whatever a concurrent flip already committed, the way a real
 * row-locked UPDATE re-checks its predicate under READ COMMITTED.
 */
function fakeDb() {
  return {
    from(table: string) {
      const rows = () => (tables[table] ??= []);
      const filters: Array<(r: Row) => boolean> = [];
      let pending: { kind: 'update'; patch: Row } | { kind: 'select' } = {
        kind: 'select',
      };
      let limitN: number | undefined;
      let countMode = false;

      const apply = () => rows().filter((r) => filters.every((f) => f(r)));

      const run = () => {
        let matched = apply();
        if (limitN !== undefined) matched = matched.slice(0, limitN);
        if (pending.kind === 'update') {
          const patch = pending.patch;
          for (const r of matched) Object.assign(r, patch);
        }
        if (countMode)
          return { data: null, error: null, count: matched.length };
        return { data: matched, error: null };
      };

      const builder = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count) countMode = true;
          return builder;
        },
        update: (patch: Row) => {
          pending = { kind: 'update', patch };
          return builder;
        },
        insert: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        neq: (col: string, val: unknown) => {
          filters.push((r) => r[col] !== val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        gte: () => builder,
        lt: (col: string, val: string) => {
          filters.push(
            (r) => typeof r[col] === 'string' && (r[col] as string) < val
          );
          return builder;
        },
        or: () => builder,
        order: () => builder,
        limit: (n: number) => {
          limitN = n;
          return builder;
        },
        single: () =>
          Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
        maybeSingle: () =>
          Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve),
      };
      return builder;
    },
  };
}

const { sendBroadcastRecipients } = await import('./sender');

beforeEach(() => {
  dispatchedTo = [];
  releaseSend = null;
  tables.broadcasts = [
    {
      id: 'bc-1',
      account_id: 'acc-1',
      user_id: 'user-1',
      status: 'sending',
      template_name: 'property_update',
      template_language: 'en_US',
      template_variables: {},
    },
  ];
  tables.broadcast_recipients = [
    {
      id: 'rec-1',
      broadcast_id: 'bc-1',
      contact_id: 'contact-1',
      status: 'pending',
      retry_after: null,
      retry_count: 0,
      created_at: '2026-08-08T16:15:54Z',
      contact: { id: 'contact-1', phone: '+919611055622', name: 'Somesh' },
    },
  ];
  tables.message_templates = [];
  tables.contact_custom_values = [];
});

describe('sendBroadcastRecipients', () => {
  it('sends a recipient once when two sweeps overlap', async () => {
    releaseSend = () => {};

    await Promise.all([
      sendBroadcastRecipients('bc-1', 'acc-1', 'user-1'),
      sendBroadcastRecipients('bc-1', 'acc-1', 'user-1'),
    ]);

    expect(dispatchedTo).toEqual(['+919611055622']);
    expect(tables.broadcast_recipients[0].status).toBe('sent');
  });

  it('leaves a claim on the row while the send is in flight', async () => {
    let statusDuringSend: unknown;
    releaseSend = () => {};
    const { sendWhatsAppMessageAndPersist } =
      await import('@/lib/whatsapp/meta-api-dispatcher');
    vi.mocked(sendWhatsAppMessageAndPersist).mockImplementationOnce(
      async () => {
        statusDuringSend = tables.broadcast_recipients[0].status;
        return { success: true, whatsappMessageId: 'wamid-1' };
      }
    );

    await sendBroadcastRecipients('bc-1', 'acc-1', 'user-1');

    expect(statusDuringSend).toBe('sending');
  });

  it('reclaims a recipient whose holder died and left the lease to expire', async () => {
    tables.broadcast_recipients[0].status = 'sending';
    tables.broadcast_recipients[0].retry_after = new Date(
      Date.now() - 60_000
    ).toISOString();

    await sendBroadcastRecipients('bc-1', 'acc-1', 'user-1');

    expect(dispatchedTo).toEqual(['+919611055622']);
  });

  it('leaves a recipient alone while another sweep still holds the lease', async () => {
    tables.broadcast_recipients[0].status = 'sending';
    tables.broadcast_recipients[0].retry_after = new Date(
      Date.now() + 60_000
    ).toISOString();

    await sendBroadcastRecipients('bc-1', 'acc-1', 'user-1');

    expect(dispatchedTo).toEqual([]);
    expect(tables.broadcast_recipients[0].status).toBe('sending');
  });

  it('does not call the broadcast finished while a claim is in flight', async () => {
    tables.broadcast_recipients[0].status = 'sending';
    tables.broadcast_recipients[0].retry_after = new Date(
      Date.now() + 60_000
    ).toISOString();

    await sendBroadcastRecipients('bc-1', 'acc-1', 'user-1');

    expect(tables.broadcasts[0].status).toBe('sending');
  });
});
