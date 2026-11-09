import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(),
}));

const { dispatchBroadcast, DISPATCH_CHUNK_SIZE } = await import('./sender');

describe('dispatchBroadcast', () => {
  it('[BRC-003] keeps claiming small chunks until nothing is left to send', async () => {
    const handled = [20, 20, 5, 0];
    const send = vi.fn(async () => ({
      handled: handled.shift() ?? 0,
      rateLimited: 0,
    }));
    const total = await dispatchBroadcast('b1', 'a1', 'u1', { send });
    expect(total).toBe(45);
    expect(send).toHaveBeenCalledTimes(4);
    for (const call of send.mock.calls as unknown[][]) {
      expect(call).toEqual(['b1', 'a1', 'u1', DISPATCH_CHUNK_SIZE]);
    }
  });

  it('[BRC-003] stops starting chunks once its time budget is spent', async () => {
    let clock = 0;
    const send = vi.fn(async () => {
      clock += 30_000;
      return { handled: 20, rateLimited: 0 };
    });
    const total = await dispatchBroadcast('b1', 'a1', 'u1', {
      send,
      budgetMs: 100_000,
      now: () => clock,
    });
    expect(send).toHaveBeenCalledTimes(4);
    expect(total).toBe(80);
  });

  it('[BRC-003] stands down at once when another dispatcher holds the broadcast', async () => {
    const send = vi.fn(async () => ({ handled: 0, rateLimited: 0 }));
    expect(await dispatchBroadcast('b1', 'a1', 'u1', { send })).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('[BRC-003] leaves rate-limited rows to the sweep instead of burning their retries in seconds', async () => {
    const outcomes = [
      { handled: 20, rateLimited: 0 },
      { handled: 20, rateLimited: 3 },
      { handled: 20, rateLimited: 0 },
    ];
    const send = vi.fn(async () => outcomes.shift()!);
    expect(await dispatchBroadcast('b1', 'a1', 'u1', { send })).toBe(40);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
