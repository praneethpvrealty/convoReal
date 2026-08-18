import { describe, it, expect, vi } from 'vitest';

import { maybeAutoHeatContact } from './auto-heat';

describe('maybeAutoHeatContact', () => {
  function db() {
    const calls: Record<string, unknown>[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ['eq', 'is']) chain[m] = () => chain;
    (chain as { then: unknown }).then = (
      resolve: (v: { error: null }) => void
    ) => resolve({ error: null });
    return {
      calls,
      from: () => ({
        update: (patch: Record<string, unknown>) => {
          calls.push(patch);
          return chain;
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  const base = (client: ReturnType<typeof db>) => ({
    db: client,
    accountId: 'acct-1',
    contact: { id: 'c-1', lead_temp: null, classification: 'Buyer' },
  });

  it('heats an unset buyer after an inbound reply', async () => {
    const client = db();
    expect(await maybeAutoHeatContact(base(client))).toBe(true);
    expect(client.calls[0]).toMatchObject({ lead_temp: 'HOT' });
  });

  it("never overwrites an agent's explicit temperature", async () => {
    // COLD is a decision, not an absence of one.
    for (const temp of ['HOT', 'COLD', 'Not Responding', 'Dead']) {
      const client = db();
      expect(
        await maybeAutoHeatContact({
          ...base(client),
          contact: { id: 'c-1', lead_temp: temp, classification: 'Buyer' },
        })
      ).toBe(false);
      expect(client.calls).toHaveLength(0);
    }
  });

  it('leaves sellers and fellow agents alone', async () => {
    for (const classification of ['Owner', 'Seller', 'Agent', 'Developer']) {
      const client = db();
      expect(
        await maybeAutoHeatContact({
          ...base(client),
          contact: { id: 'c-1', lead_temp: null, classification },
        })
      ).toBe(false);
      expect(client.calls).toHaveLength(0);
    }
  });

  it('reports false rather than throwing when the write fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = {
      from: () => {
        throw new Error('db down');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(
      await maybeAutoHeatContact({
        db: failing,
        accountId: 'acct-1',
        contact: { id: 'c-1', lead_temp: null, classification: 'Buyer' },
      })
    ).toBe(false);
    spy.mockRestore();
  });
});
