import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  contact: { id: 'c1', do_not_contact: false } as Record<
    string,
    unknown
  > | null,
  updates: [] as Record<string, unknown>[],
  notes: [] as Record<string, unknown>[],
  updatedRows: [{ id: 'c1' }] as { id: string }[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'agent',
    supabase: { from: table },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

function table(name: string) {
  let updating = false;
  const builder = {
    select: () => {
      if (updating) {
        return Promise.resolve({ data: state.updatedRows, error: null });
      }
      return builder;
    },
    eq: () => builder,
    update: (patch: Record<string, unknown>) => {
      updating = true;
      state.updates.push(patch);
      return builder;
    },
    insert: async (row: Record<string, unknown>) => {
      if (name === 'contact_notes') state.notes.push(row);
      return { error: null };
    },
    maybeSingle: async () => ({ data: state.contact, error: null }),
  };
  return builder;
}

import { PATCH } from './route';

function call(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/contacts/c1/do-not-contact', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'c1' }) }
  );
}

describe('[CTM-021] PATCH /api/contacts/[id]/do-not-contact', () => {
  beforeEach(() => {
    state.contact = { id: 'c1', do_not_contact: false };
    state.updates = [];
    state.notes = [];
    state.updatedRows = [{ id: 'c1' }];
  });

  it('turns it on with who, when and why, and leaves a note', async () => {
    const res = await call({ enabled: true, reason: '  deals via   his son ' });

    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      do_not_contact: true,
      do_not_contact_by: 'user-1',
      do_not_contact_reason: 'deals via his son',
    });
    expect(state.updates[0].do_not_contact_at).toEqual(expect.any(String));
    expect(state.notes[0]).toMatchObject({
      contact_id: 'c1',
      account_id: 'acc-1',
      user_id: 'user-1',
      note_text: 'Marked Do not contact: deals via his son',
    });
  });

  it('turns it off and clears the record of who set it', async () => {
    state.contact = { id: 'c1', do_not_contact: true };

    const res = await call({ enabled: false, reason: 'ignored' });

    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      do_not_contact: false,
      do_not_contact_at: null,
      do_not_contact_by: null,
      do_not_contact_reason: null,
    });
    expect(state.notes).toHaveLength(1);
  });

  it('writes nothing when the value is unchanged', async () => {
    const res = await call({ enabled: false });

    expect(await res.json()).toEqual({
      data: { enabled: false, changed: false },
    });
    expect(state.updates).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
  });

  it('rejects a body without a boolean', async () => {
    const res = await call({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('404s for a contact outside the account', async () => {
    state.contact = null;
    const res = await call({ enabled: true });
    expect(res.status).toBe(404);
  });

  it('403s when RLS lets the read through but not the write', async () => {
    state.updatedRows = [];
    const res = await call({ enabled: true });
    expect(res.status).toBe(403);
    expect(state.notes).toHaveLength(0);
  });
});
