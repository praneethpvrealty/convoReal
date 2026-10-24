import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROPERTY = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
let contactRow: Record<string, unknown> | null;
let writeRole: () => Promise<unknown>;
let writeRows: unknown[];
let feedbackRow: Record<string, unknown> | null;
let propertyRow: Record<string, unknown>;
let insertError: unknown;
let noteRow: Record<string, unknown> | null;
let upsertError: unknown;

function table(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {};
  for (const op of ['select', 'eq', 'or', 'order', 'limit', 'in']) {
    query[op] = (...args: unknown[]) => {
      calls.push({ table: name, op, args });
      return query;
    };
  }
  for (const op of ['upsert', 'update', 'insert', 'delete']) {
    query[op] = (...args: unknown[]) => {
      calls.push({ table: name, op, args });
      return query;
    };
  }
  query.maybeSingle = () =>
    Promise.resolve({
      data:
        name === 'contacts'
          ? contactRow
          : name === 'listing_feedback'
            ? feedbackRow
            : name === 'contact_notes'
              ? noteRow
              : propertyRow,
      error: null,
    });
  query.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      calls.at(-1)?.op === 'insert'
        ? { data: null, error: insertError }
        : calls.at(-1)?.op === 'upsert'
          ? { data: null, error: upsertError }
          : { data: writeRows, error: null }
    ).then(resolve);
  return query;
}

const ctx = {
  supabase: { from: (name: string) => table(name) },
  accountId: 'account-1',
  userId: 'user-1',
};

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ctx,
  requireWriteRole: () => writeRole(),
  toErrorResponse: (err: Error & { status?: number }) =>
    Response.json({ error: err.message }, { status: err.status ?? 500 }),
}));

const { POST, DELETE } = await import('./route');

const params = { params: Promise.resolve({ id: PROPERTY }) };

function post(body: unknown) {
  return POST(
    new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
    params
  );
}

beforeEach(() => {
  calls.length = 0;
  contactRow = { id: CONTACT, requirement_profiles: [] };
  writeRole = async () => ctx;
  writeRows = [{ id: 'row-1' }];
  feedbackRow = null;
  propertyRow = { id: PROPERTY };
  insertError = null;
  noteRow = null;
  upsertError = null;
});

describe('[PRP-051] POST /api/properties/[id]/match-feedback', () => {
  it('records an agent mark and saves the type the agent named', async () => {
    const res = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'type',
      propertyTypes: ['pt_plot'],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ typeSaved: true });

    const upsert = calls.find((c) => c.op === 'upsert');
    expect(upsert?.table).toBe('listing_feedback');
    expect(upsert?.args[0]).toMatchObject({
      account_id: 'account-1',
      contact_id: CONTACT,
      property_id: PROPERTY,
      verdict: 'rejected',
      reason: 'type',
      source: 'agent',
      created_by: 'user-1',
    });

    const update = calls.find((c) => c.op === 'update');
    expect(update?.table).toBe('contacts');
    expect(update?.args[0]).toEqual({
      pref_property_types: ['Residential Land/ Plot'],
      pref_property_categories: [],
      property_interests: [],
    });
    expect(
      calls.some(
        (c) =>
          c.table === 'contacts' &&
          c.op === 'eq' &&
          c.args[0] === 'account_id' &&
          c.args[1] === 'account-1'
      )
    ).toBe(true);

    const note = calls.find((c) => c.op === 'insert');
    expect(note?.table).toBe('contact_notes');
    expect(note?.args[0]).toMatchObject({
      contact_id: CONTACT,
      user_id: 'user-1',
    });
  });

  it('fills a brief that names no type and leaves a stated one alone', async () => {
    contactRow = {
      id: CONTACT,
      requirement_profiles: [
        { id: 'a', active: true, property_types: [], property_categories: [] },
        {
          id: 'b',
          active: true,
          property_types: ['Commercial Shop'],
          property_categories: [],
        },
      ],
    };
    await post({
      action: 'set_type',
      contactId: CONTACT,
      propertyTypes: ['pt_agri'],
    });
    const update = calls.find((c) => c.op === 'update');
    const profiles = (update?.args[0] as { requirement_profiles: unknown[] })
      .requirement_profiles as { property_types: string[] }[];
    expect(profiles[0].property_types).toEqual(['Agricultural Land']);
    expect(profiles[1].property_types).toEqual(['Commercial Shop']);
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('rewrites the typed brief that put the contact on this listing, not another', async () => {
    propertyRow = {
      id: PROPERTY,
      title: 'Commercial Building',
      type: 'Commercial Building',
      listing_type: 'Sale',
      price: 150_000_000,
      city: 'Bengaluru',
    };
    contactRow = {
      id: CONTACT,
      classification: 'Buyer',
      requirement_profiles: [
        {
          id: 'office',
          raw_text: 'Commercial office space in Bengaluru',
          active: true,
          property_types: ['Commercial Office Space'],
          property_categories: [],
        },
        {
          id: 'farm',
          raw_text: 'Farmland near Bengaluru',
          active: true,
          property_types: ['Agricultural Land'],
          property_categories: [],
        },
      ],
    };
    await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'type',
      propertyTypes: ['pt_plot'],
    });
    const update = calls.find((c) => c.op === 'update');
    const profiles = (update?.args[0] as { requirement_profiles: unknown[] })
      .requirement_profiles as { id: string; property_types: string[] }[];
    expect(profiles.find((p) => p.id === 'office')?.property_types).toEqual([
      'Residential Land/ Plot',
    ]);
    expect(profiles.find((p) => p.id === 'farm')?.property_types).toEqual([
      'Agricultural Land',
    ]);
  });

  it('reports the type as not saved when the note that keeps it fails', async () => {
    insertError = { message: 'boom' };
    const res = await post({
      action: 'set_type',
      contactId: CONTACT,
      propertyTypes: ['pt_plot'],
    });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('TYPE_NOT_SAVED');
  });

  it('marks without touching the contact when no type is named', async () => {
    const res = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'budget',
    });
    expect((await res.json()).data).toEqual({ typeSaved: false });
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('refuses an unknown reason, a type on a non-type reason and a stray type id', async () => {
    for (const body of [
      { action: 'reject', contactId: CONTACT, reason: 'price' },
      {
        action: 'reject',
        contactId: CONTACT,
        reason: 'budget',
        propertyTypes: ['pt_plot'],
      },
      { action: 'set_type', contactId: CONTACT, propertyTypes: ['bogus'] },
      { action: 'set_type', contactId: CONTACT, propertyTypes: [] },
      { action: 'reject', contactId: 'not-a-uuid', reason: 'type' },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('reports a contact update RLS refused as not saved', async () => {
    writeRows = [];
    const res = await post({
      action: 'set_type',
      contactId: CONTACT,
      propertyTypes: ['pt_plot'],
    });
    expect(res.status).toBe(500);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it("leaves the buyer's own rejection in place and still saves the type", async () => {
    feedbackRow = { verdict: 'rejected', source: 'contact' };
    const res = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'type',
      propertyTypes: ['pt_plot'],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ typeSaved: true });
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it("refuses to overwrite the buyer's own interest", async () => {
    feedbackRow = { verdict: 'interested', source: 'contact' };
    const res = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'budget',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CONTACT_INTERESTED');
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('replaces an earlier agent mark', async () => {
    feedbackRow = { verdict: 'rejected', source: 'agent' };
    await post({ action: 'reject', contactId: CONTACT, reason: 'size' });
    const upsert = calls.find((c) => c.op === 'upsert');
    expect(upsert?.args[0]).toMatchObject({ reason: 'size', source: 'agent' });
  });

  it('writes no mark when the type it carries fails to save', async () => {
    writeRows = [];
    const res = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'type',
      propertyTypes: ['pt_plot'],
    });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('TYPE_NOT_SAVED');
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('writes the type note once, however often the type is saved', async () => {
    noteRow = { id: 'note-1' };
    const res = await post({
      action: 'set_type',
      contactId: CONTACT,
      propertyTypes: ['pt_plot'],
    });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('reports a buyer who said interested while the mark was being saved', async () => {
    upsertError = { message: 'new row violates row-level security policy' };
    const res = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'budget',
    });
    expect(res.status).toBe(500);

    const typed = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'type',
      propertyTypes: ['pt_plot'],
    });
    expect(typed.status).toBe(500);
    expect((await typed.json()).error).toMatch(/property type was saved/);

    feedbackRow = null;
    const realFeedback = { verdict: 'interested', source: 'contact' };
    let reads = 0;
    const origFrom = ctx.supabase.from;
    ctx.supabase.from = (name: string) => {
      const q = origFrom(name);
      if (name === 'listing_feedback') {
        const ms = q.maybeSingle;
        q.maybeSingle = () => {
          reads += 1;
          return reads === 1
            ? ms()
            : Promise.resolve({ data: realFeedback, error: null });
        };
      }
      return q;
    };
    try {
      const raced = await post({
        action: 'reject',
        contactId: CONTACT,
        reason: 'budget',
      });
      expect(raced.status).toBe(409);
      expect((await raced.json()).code).toBe('CONTACT_INTERESTED');
    } finally {
      ctx.supabase.from = origFrom;
    }
  });

  it('404s a contact outside the account', async () => {
    contactRow = null;
    const res = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'type',
    });
    expect(res.status).toBe(404);
  });

  it('refuses a read-only member', async () => {
    writeRole = async () => {
      throw Object.assign(new Error('Read-only members cannot make changes.'), {
        status: 403,
      });
    };
    const res = await post({
      action: 'reject',
      contactId: CONTACT,
      reason: 'type',
    });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe('[PRP-051] DELETE /api/properties/[id]/match-feedback', () => {
  it('undoes only an agent mark, within the account and listing', async () => {
    const res = await DELETE(
      new Request(`http://x?contactId=${CONTACT}`, { method: 'DELETE' }),
      params
    );
    expect(res.status).toBe(200);
    const filters = calls
      .filter((c) => c.table === 'listing_feedback' && c.op === 'eq')
      .map((c) => c.args);
    expect(filters).toEqual([
      ['account_id', 'account-1'],
      ['property_id', PROPERTY],
      ['contact_id', CONTACT],
      ['verdict', 'rejected'],
      ['source', 'agent'],
    ]);
  });

  it('does not report a restore that removed nothing', async () => {
    writeRows = [];
    const res = await DELETE(
      new Request(`http://x?contactId=${CONTACT}`, { method: 'DELETE' }),
      params
    );
    expect(res.status).toBe(404);
  });
});
