import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A broadcast must be dispatched by one runner at a time.
 *
 * sendBroadcastRecipients() reads recipients while they are still
 * 'pending' and only marks them sent afterwards, so two concurrent
 * runners read the same set and both send. There are two runners in
 * production — the fire-and-forget promise that starts a broadcast, and
 * the sweep cron that rescues stalled ones — and a real batch went out
 * 100% duplicated because of it.
 *
 * These pin the contract the lease provides: losing the claim means
 * sending nothing at all, and the claim is always released.
 */

const rpc = vi.fn();
const from = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc, from }),
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(),
}));

const { sendBroadcastRecipients } = await import('./sender');

/** The broadcast row lookup that runs before the claim. */
function broadcastRow(status = 'sending') {
  return {
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: {
            id: 'b1',
            status,
            template_name: 'listing_status_notice',
            account_id: 'a1',
            user_id: 'u1',
          },
          error: null,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue(broadcastRow());
});

describe('broadcast dispatch lease', () => {
  it('sends nothing when another dispatcher holds the claim', async () => {
    rpc.mockImplementation((fn: string) =>
      fn === 'claim_broadcast_dispatch'
        ? Promise.resolve({ data: false, error: null })
        : Promise.resolve({ data: null, error: null })
    );

    await sendBroadcastRecipients('b1', 'a1', 'u1');

    // The recipient query is the step that precedes every send; never
    // reaching it is the proof that nothing went out.
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('broadcast_recipients');
  });

  it('claims before it reads recipients, never the other way round', async () => {
    // Reading first and claiming later would leave the same race open.
    const order: string[] = [];
    rpc.mockImplementation((fn: string) => {
      order.push(`rpc:${fn}`);
      return Promise.resolve({
        data: fn === 'claim_broadcast_dispatch' ? false : null,
        error: null,
      });
    });
    from.mockImplementation((table: string) => {
      order.push(`from:${table}`);
      return broadcastRow();
    });

    await sendBroadcastRecipients('b1', 'a1', 'u1');

    expect(order[0]).toBe('from:broadcasts');
    expect(order[1]).toBe('rpc:claim_broadcast_dispatch');
  });

  it('does not claim a broadcast that is no longer sending', async () => {
    from.mockReturnValue(broadcastRow('sent'));
    await sendBroadcastRecipients('b1', 'a1', 'u1');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stands down rather than sending when the claim errors', async () => {
    // An unreachable lease must fail closed: a duplicate message costs
    // a template charge and a spam report, a delayed one costs neither.
    rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    await sendBroadcastRecipients('b1', 'a1', 'u1');

    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('broadcast_recipients');
  });
});

/**
 * The lease alone was not enough. It provably serialises callers of
 * claim_broadcast_dispatch — verified against the real database — yet a
 * live batch still sent 46 of 50 leads twice, one pair 2ms apart. Two
 * sends 2ms apart cannot come from one sequential loop, so a second
 * sender exists that never passes through the lease.
 *
 * These pin the property that does not depend on identifying it:
 * sending is gated on winning an atomic claim of the recipient row, so
 * a sender that did not win the row has nothing to send.
 */
describe('broadcast recipient claim', () => {
  it('sends only to rows the claim actually returned', async () => {
    // Not "reads pending rows and sends" — the claim IS the permission.
    rpc.mockImplementation((fn: string) => {
      if (fn === 'claim_broadcast_dispatch')
        return Promise.resolve({ data: true, error: null });
      if (fn === 'claim_broadcast_recipients')
        return Promise.resolve({ data: [], error: null });
      if (fn === 'broadcast_outstanding_count')
        return Promise.resolve({ data: 5, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    await sendBroadcastRecipients('b1', 'a1', 'u1');

    const claims = rpc.mock.calls.map((c) => c[0]);
    expect(claims).toContain('claim_broadcast_recipients');
    // Claimed nothing, so nothing may be sent — and with work still
    // outstanding the broadcast must not be closed out either.
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('messages');
  });

  it('never reads pending recipients directly, which is what let a second sender in', async () => {
    // Work still outstanding, so the close-out path stays out of the way
    // and this asserts only where recipients come from.
    rpc.mockImplementation((fn: string) =>
      Promise.resolve({
        data:
          fn === 'claim_broadcast_dispatch'
            ? true
            : fn === 'claim_broadcast_recipients'
              ? []
              : 7,
        error: null,
      })
    );

    await sendBroadcastRecipients('b1', 'a1', 'u1');

    // A plain select on broadcast_recipients would reintroduce the bug.
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('broadcast_recipients');
  });
});
