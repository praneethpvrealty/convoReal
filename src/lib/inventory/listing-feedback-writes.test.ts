import { describe, expect, it, vi } from 'vitest';

import { clearAgentMarkReasons } from '@/lib/inventory/listing-feedback-writes';

function recordingDb(result: { error: unknown } = { error: null }) {
  const calls: [string, unknown[]][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {};
  for (const op of ['update', 'eq', 'in', 'select']) {
    query[op] = (...args: unknown[]) => {
      calls.push([op, args]);
      return op === 'select' ? Promise.resolve(result) : query;
    };
  }
  const db = {
    from: (table: string) => {
      calls.push(['from', [table]]);
      return query;
    },
  } as never;
  return { db, calls };
}

describe('[PRP-051] clearAgentMarkReasons', () => {
  it("clears the reason on agent marks only, never the buyer's own", async () => {
    const { db, calls } = recordingDb();
    await clearAgentMarkReasons(db, 'acc-1', 'c-1', ['p-1', 'p-2']);
    expect(calls).toEqual([
      ['from', ['listing_feedback']],
      ['update', [{ reason: null }]],
      ['eq', ['account_id', 'acc-1']],
      ['eq', ['contact_id', 'c-1']],
      ['in', ['property_id', ['p-1', 'p-2']]],
      ['eq', ['source', 'agent']],
      ['select', ['id']],
    ]);
  });

  it('writes nothing for no listings', async () => {
    const { db, calls } = recordingDb();
    await clearAgentMarkReasons(db, 'acc-1', 'c-1', []);
    expect(calls).toHaveLength(0);
  });

  it("never throws into the buyer's write", async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = recordingDb({ error: { message: 'boom' } });
    await expect(
      clearAgentMarkReasons(db, 'acc-1', 'c-1', ['p-1'])
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
