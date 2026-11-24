import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./events', () => ({ writeDealEvent: async () => ({ ok: true }) }));

import { syncDealParticipants } from './participants-server';

interface Row {
  id: string;
  contact_id: string | null;
  name: string;
  role: string;
}

const state = {
  contacts: [] as { id: string; name: string; phone: string; email: null }[],
  stakeholders: [] as Row[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as { id: string; fields: Record<string, unknown> }[],
  deleted: [] as string[],
};

function db() {
  return {
    from: (table: string) => {
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let payload: Record<string, unknown> = {};
      let id = '';
      const builder = {
        select: () => builder,
        insert: (row: Record<string, unknown>) => {
          op = 'insert';
          payload = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          op = 'update';
          payload = row;
          return builder;
        },
        delete: () => {
          op = 'delete';
          return builder;
        },
        eq: (column: string, value: string) => {
          if (column === 'id') id = value;
          return builder;
        },
        in: () => builder,
        not: () => builder,
        single: async () => {
          state.inserted.push(payload);
          return { data: { id: `new-${state.inserted.length}` }, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (op === 'update') state.updated.push({ id, fields: payload });
          if (op === 'delete') state.deleted.push(id);
          return resolve({
            data:
              table === 'contacts'
                ? state.contacts
                : state.stakeholders.filter((s) => s.contact_id !== null),
            error: null,
          });
        },
      };
      return builder;
    },
  };
}

function sync(
  participants: { contact_id: string; role: 'buyer' | 'seller' | 'agent' }[]
) {
  return syncDealParticipants({
    db: db() as never,
    accountId: 'acct-1',
    dealId: 'deal-1',
    userId: 'agent-1',
    actorName: 'Agent',
    source: 'web',
    participants,
  });
}

beforeEach(() => {
  state.contacts = [];
  state.stakeholders = [];
  state.inserted = [];
  state.updated = [];
  state.deleted = [];
});

describe('[PIPE-007] syncDealParticipants', () => {
  it('adds a missing contact as a stakeholder with its role, side and normalised phone', async () => {
    state.contacts = [
      { id: 'victor', name: 'Victor', phone: '+91 98339 02005', email: null },
    ];
    const result = await sync([{ contact_id: 'victor', role: 'agent' }]);
    expect(result).toMatchObject({ ok: true, added: 1, removed: 0 });
    expect(state.inserted[0]).toMatchObject({
      account_id: 'acct-1',
      deal_id: 'deal-1',
      contact_id: 'victor',
      name: 'Victor',
      phone: '919833902005',
      role: 'broker',
      side: 'internal',
    });
  });

  it('re-roles a changed contact, removes one no longer listed and leaves other stakeholders alone', async () => {
    state.contacts = [
      { id: 'nimmy', name: 'Nimmy', phone: '919000000001', email: null },
    ];
    state.stakeholders = [
      { id: 's-nimmy', contact_id: 'nimmy', name: 'Nimmy', role: 'buyer' },
      { id: 's-old', contact_id: 'old', name: 'Old buyer', role: 'buyer' },
      { id: 's-adv', contact_id: 'adv', name: 'Advocate', role: 'advocate' },
      { id: 's-typed', contact_id: null, name: 'Typed in', role: 'seller' },
    ];
    const result = await sync([{ contact_id: 'nimmy', role: 'seller' }]);
    expect(result).toMatchObject({
      ok: true,
      added: 0,
      updated: 1,
      removed: 1,
    });
    expect(state.updated).toEqual([
      { id: 's-nimmy', fields: { role: 'seller', side: 'seller' } },
    ]);
    expect(state.deleted).toEqual(['s-old']);
    expect(state.inserted).toHaveLength(0);
  });

  it("writes no row when a deal's only contact is swapped for another lone buyer, and drops the old one", async () => {
    state.contacts = [
      { id: 'b', name: 'B', phone: '919000000002', email: null },
    ];
    state.stakeholders = [
      { id: 's-a', contact_id: 'a', name: 'A', role: 'buyer' },
    ];
    const result = await sync([{ contact_id: 'b', role: 'buyer' }]);
    expect(result).toMatchObject({ ok: true, added: 0, removed: 1 });
    expect(state.inserted).toHaveLength(0);
    expect(state.deleted).toEqual(['s-a']);
  });

  it("keeps the primary buyer's existing row, and its share link, when the other contacts are removed", async () => {
    state.contacts = [
      { id: 'a', name: 'A', phone: '919000000001', email: null },
    ];
    state.stakeholders = [
      { id: 's-a', contact_id: 'a', name: 'A', role: 'buyer' },
      { id: 's-b', contact_id: 'b', name: 'B', role: 'seller' },
    ];
    const result = await sync([{ contact_id: 'a', role: 'buyer' }]);
    expect(result).toMatchObject({
      ok: true,
      added: 0,
      updated: 0,
      removed: 1,
    });
    expect(state.deleted).toEqual(['s-b']);
    expect(state.inserted).toHaveLength(0);
  });

  it('writes nothing when a contact is not in the account', async () => {
    state.contacts = [];
    const result = await sync([{ contact_id: 'stranger', role: 'buyer' }]);
    expect(result.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
    expect(state.deleted).toHaveLength(0);
  });
});
