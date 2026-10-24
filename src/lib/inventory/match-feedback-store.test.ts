import { describe, expect, it } from 'vitest';

import { loadTypeSuggestions } from '@/lib/inventory/match-feedback-store';
import { SUGGESTION_CONTACT_CAP } from '@/lib/match-feedback';

type Call = { table: string; op: string; args: unknown[] };

function fakeDb(rows: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = {};
      for (const op of ['select', 'eq', 'in', 'or', 'order', 'limit']) {
        query[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return query;
        };
      }
      query.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
      return query;
    },
  } as never;
  return { db, calls };
}

const building = { type: 'Commercial Building', title: 'Office block' };
const plot = { type: 'Residential Land/ Plot', title: 'Site' };

describe('[PRP-051] loadTypeSuggestions', () => {
  it("reads only the listed contacts' signals, with no account-wide window", async () => {
    const { db, calls } = fakeDb({
      listing_feedback: [
        {
          contact_id: 'c-1',
          verdict: 'rejected',
          reason: 'type',
          properties: building,
        },
        {
          contact_id: 'c-1',
          verdict: 'interested',
          reason: null,
          properties: plot,
        },
      ],
      contact_property_inquiries: [{ contact_id: 'c-1', properties: plot }],
    });
    const suggestions = await loadTypeSuggestions(db, 'acc-1', ['c-1', 'c-2']);
    expect(suggestions).toEqual({ 'c-1': 'pt_plot' });

    const feedbackCalls = calls.filter((c) => c.table === 'listing_feedback');
    expect(feedbackCalls).toContainEqual({
      table: 'listing_feedback',
      op: 'in',
      args: ['contact_id', ['c-1', 'c-2']],
    });
    expect(calls.some((c) => c.op === 'limit')).toBe(false);
    expect(
      calls.find(
        (c) => c.table === 'contact_property_inquiries' && c.op === 'in'
      )?.args
    ).toEqual(['contact_id', ['c-1']]);
  });

  it('takes at most the cap, in the order given', async () => {
    const { db, calls } = fakeDb({});
    const ids = Array.from(
      { length: SUGGESTION_CONTACT_CAP + 20 },
      (_, i) => `c-${i}`
    );
    await loadTypeSuggestions(db, 'acc-1', ids);
    const inCall = calls.find((c) => c.op === 'in');
    expect(inCall?.args[1]).toEqual(ids.slice(0, SUGGESTION_CONTACT_CAP));
  });

  it('asks nothing for no contacts', async () => {
    const { db, calls } = fakeDb({});
    expect(await loadTypeSuggestions(db, 'acc-1', [])).toEqual({});
    expect(calls).toHaveLength(0);
  });
});
