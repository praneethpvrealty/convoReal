import { beforeEach, describe, expect, it, vi } from 'vitest';

const SUBJECT = '11111111-2222-4333-8444-555555555555';

let scope: string;
let filters: [string, string, unknown][];
let focusRows: { subject_id: string }[];
let ownedIds: string[];
let upserts: { row: Record<string, unknown>; options: unknown }[];
let role: 'viewer' | 'agent';

function builder(table: string) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    select: () => chain,
    eq: (column: unknown, value: unknown) => {
      filters.push([table, `eq:${String(column)}`, value]);
      return chain;
    },
    is: (column: unknown, value: unknown) => {
      filters.push([table, `is:${String(column)}`, value]);
      return chain;
    },
    in: () => chain,
    limit: () => chain,
    single: async () => ({
      data: { journey_compartment_scope: scope },
      error: null,
    }),
    upsert: async (row: unknown, options: unknown) => {
      upserts.push({ row: row as Record<string, unknown>, options });
      return { error: null };
    },
    then: (resolve: unknown, reject: unknown) =>
      Promise.resolve({
        data:
          table === 'journey_items'
            ? ownedIds.map((id) => ({ contact_id: id }))
            : focusRows,
        error: null,
      }).then(
        resolve as (v: unknown) => unknown,
        reject as (v: unknown) => unknown
      ),
  };
  return chain;
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (min: string) => {
    if (min === 'agent' && role === 'viewer') {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return {
      supabase: { from: (table: string) => builder(table) },
      accountId: 'acc-1',
      userId: 'user-1',
    };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: (err as Error).message },
      { status: (err as { status?: number }).status ?? 500 }
    ),
}));

const { GET, POST } = await import('./route');

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/journey/compartments', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('/api/journey/compartments', () => {
  beforeEach(() => {
    scope = 'team';
    filters = [];
    focusRows = [{ subject_id: SUBJECT }];
    ownedIds = [SUBJECT];
    upserts = [];
    role = 'agent';
  });

  it('[JRN-014] reads the team Focus list by default, scoped to the account', async () => {
    const res = await GET(
      new Request('http://localhost/api/journey/compartments?mode=buyer')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { scope: 'team', focus: [SUBJECT] },
    });
    expect(filters).toContainEqual([
      'journey_compartments',
      'eq:account_id',
      'acc-1',
    ]);
    expect(filters).toContainEqual([
      'journey_compartments',
      'eq:compartment',
      'focus',
    ]);
    expect(filters).toContainEqual([
      'journey_compartments',
      'is:user_id',
      null,
    ]);
  });

  it('[JRN-014] reads only the caller’s own list when the admin chose per-agent', async () => {
    scope = 'agent';
    const res = await GET(
      new Request('http://localhost/api/journey/compartments?mode=property')
    );
    expect((await res.json()).data.scope).toBe('agent');
    expect(filters).toContainEqual([
      'journey_compartments',
      'eq:user_id',
      'user-1',
    ]);
  });

  it('[JRN-014] moves a journey into Focus for the team or for the agent', async () => {
    let res = await post({
      mode: 'buyer',
      subjectId: SUBJECT,
      compartment: 'focus',
    });
    expect(res.status).toBe(200);
    expect(upserts[0].row).toMatchObject({
      account_id: 'acc-1',
      mode: 'buyer',
      subject_id: SUBJECT,
      user_id: null,
      compartment: 'focus',
    });
    expect(upserts[0].options).toEqual({
      onConflict: 'account_id,mode,subject_id,user_id',
    });

    scope = 'agent';
    res = await post({
      mode: 'buyer',
      subjectId: SUBJECT,
      compartment: 'passive',
    });
    expect(res.status).toBe(200);
    expect(upserts[1].row).toMatchObject({
      user_id: 'user-1',
      compartment: 'passive',
    });
  });

  it('[JRN-014] refuses bad input, foreign journeys and viewers', async () => {
    expect(
      (await post({ mode: 'buyer', subjectId: SUBJECT, compartment: 'x' }))
        .status
    ).toBe(400);
    ownedIds = [];
    expect(
      (await post({ mode: 'buyer', subjectId: SUBJECT, compartment: 'focus' }))
        .status
    ).toBe(404);
    role = 'viewer';
    expect(
      (await post({ mode: 'buyer', subjectId: SUBJECT, compartment: 'focus' }))
        .status
    ).toBe(403);
    expect(upserts).toEqual([]);
  });
});
