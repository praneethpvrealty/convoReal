import { describe, it, expect, vi, beforeEach } from 'vitest';

const rankPropertiesForContact = vi.fn();

vi.mock('@/lib/radar/engine', () => ({
  rankPropertiesForContact: (...args: unknown[]) =>
    rankPropertiesForContact(...args),
}));

const { applyAgentCommand } = await import('./agent-command-apply');

/**
 * A staff command writes the same deterministic fields a buyer's own
 * band tap writes — that equivalence is what makes an agent-filed
 * number behave identically in matching. These pin it, and pin that
 * the acknowledgement never leaves the Engine.
 */

function stubDb(updateReturns: unknown[] = [{ id: 'c1' }]) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['eq']) chain[m] = () => chain;
      chain.update = (patch: unknown) => {
        calls.push({ table, method: 'update', args: [patch] });
        return chain;
      };
      chain.insert = (row: unknown) => {
        calls.push({ table, method: 'insert', args: [row] });
        return Promise.resolve({ error: null });
      };
      chain.select = () => {
        calls.push({ table, method: 'select', args: [] });
        return Promise.resolve({ data: updateReturns });
      };
      return chain;
    },
  } as never;
  return { db, calls };
}

const base = {
  accountId: 'acct-1',
  userId: 'user-1',
  contactId: 'c1',
  contactName: 'Aryan Verma',
  conversationId: 'conv-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  rankPropertiesForContact.mockResolvedValue([{}, {}, {}]);
});

describe('applyAgentCommand', () => {
  it('writes the same pref_budget_* fields a buyer band tap writes', async () => {
    const { db, calls } = stubDb();

    const result = await applyAgentCommand({
      ...base,
      db,
      command: { kind: 'budget', min: null, max: 20_000_000, none: false },
    });

    expect(result.applied).toBe(true);
    const update = calls.find((c) => c.table === 'contacts');
    expect(update?.args[0]).toEqual({
      no_budget: false,
      pref_budget_min: null,
      pref_budget_max: 20_000_000,
    });
  });

  it('clears a stale range when the budget is set to none', async () => {
    const { db, calls } = stubDb();

    await applyAgentCommand({
      ...base,
      db,
      command: { kind: 'budget', min: null, max: null, none: true },
    });

    expect(calls.find((c) => c.table === 'contacts')?.args[0]).toEqual({
      no_budget: true,
      pref_budget_min: null,
      pref_budget_max: null,
    });
  });

  it('ranks after the write, so the count reflects the new budget', async () => {
    const { db, calls } = stubDb();

    const result = await applyAgentCommand({
      ...base,
      db,
      command: { kind: 'budget', min: null, max: 20_000_000, none: false },
    });

    expect(result.matchCount).toBe(3);
    const order = calls.map((c) => `${c.table}:${c.method}`);
    expect(order.indexOf('contacts:update')).toBeLessThan(
      order.indexOf('messages:insert')
    );
    expect(rankPropertiesForContact).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'c1',
      { strictArea: true }
    );
  });

  it('records the acknowledgement as a private note, never a WhatsApp send', async () => {
    const { db, calls } = stubDb();

    await applyAgentCommand({
      ...base,
      db,
      command: { kind: 'budget', min: null, max: 20_000_000, none: false },
    });

    const note = calls.find((c) => c.table === 'messages');
    expect(note?.args[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      private: true,
    });
  });

  it('reports a refused write instead of claiming the budget was saved', async () => {
    // A contact outside this account updates zero rows; telling the
    // agent it worked would leave them trusting a brief that never
    // changed.
    const { db } = stubDb([]);

    const result = await applyAgentCommand({
      ...base,
      db,
      command: { kind: 'budget', min: null, max: 20_000_000, none: false },
    });

    expect(result.applied).toBe(false);
    expect(result.ack).toContain('Could not update');
    expect(rankPropertiesForContact).not.toHaveBeenCalled();
  });

  it('still acknowledges when ranking fails — the budget did save', async () => {
    rankPropertiesForContact.mockRejectedValue(new Error('inventory down'));
    const { db } = stubDb();

    const result = await applyAgentCommand({
      ...base,
      db,
      command: { kind: 'budget', min: null, max: 20_000_000, none: false },
    });

    expect(result.applied).toBe(true);
    expect(result.matchCount).toBe(0);
  });
});
