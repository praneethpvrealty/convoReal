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
