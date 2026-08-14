import { describe, it, expect, vi } from 'vitest';

import { carriesHotSignal, maybeAutoHeatContact } from './auto-heat';

// A ₹5-10 Cr Magic Bricks lead enquired on two listings, asked "is the
// price negotiable", promised to call back — and sat at lead_temp null,
// invisible to the HOT-going-quiet watchdog that exists for exactly
// him. These pin the behavioural signals that now set the flag, and —
// just as much — the judgements they must never overwrite.

describe('carriesHotSignal', () => {
  it.each([
    [
      'Ok, then I can see it sometime tomorrow and get back. Is the price negotiable.',
      true,
    ],
    ['is it negotiable?', true],
    ['what is the best price', true],
    ['any discount possible', true],
    ['can we close it at 12cr', true],
    ['I would like to visit the site', true],
    ['can we do a site visit this weekend', true],
    ['show me the property', true],
  ])('%s → hot', (text, expected) => {
    expect(carriesHotSignal(text)).toBe(expected);
  });

  it.each([
    // Ordinary qualification traffic is not heat by itself.
    ['Looking for commercial land around the peripherals', false],
    ['Devanahalli', false],
    ['send me the photos', false],
    ['Hi', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%s → not hot', (text, expected) => {
    expect(carriesHotSignal(text)).toBe(expected);
  });
});

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

  it('heats an unset buyer on an explicit enquiry', async () => {
    const client = db();
    expect(
      await maybeAutoHeatContact({ ...base(client), explicitEnquiry: true })
    ).toBe(true);
    expect(client.calls[0]).toMatchObject({ lead_temp: 'HOT' });
  });

  it('heats an unset buyer on a price question', async () => {
    const client = db();
    expect(
      await maybeAutoHeatContact({
        ...base(client),
        text: 'Is the price negotiable',
      })
    ).toBe(true);
  });

  it("never overwrites an agent's explicit temperature", async () => {
    // COLD is a decision, not an absence of one.
    for (const temp of ['HOT', 'COLD', 'Not Responding', 'Dead']) {
      const client = db();
      expect(
        await maybeAutoHeatContact({
          ...base(client),
          contact: { id: 'c-1', lead_temp: temp, classification: 'Buyer' },
          explicitEnquiry: true,
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
          text: 'is the price negotiable',
        })
      ).toBe(false);
      expect(client.calls).toHaveLength(0);
    }
  });

  it('does nothing on an ordinary message', async () => {
    const client = db();
    expect(
      await maybeAutoHeatContact({ ...base(client), text: 'Devanahalli' })
    ).toBe(false);
    expect(client.calls).toHaveLength(0);
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
        explicitEnquiry: true,
      })
    ).toBe(false);
    spy.mockRestore();
  });
});
