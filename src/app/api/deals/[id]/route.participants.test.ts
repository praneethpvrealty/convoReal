import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  knownContacts: true,
  updates: [] as Record<string, unknown>[],
}));
const syncDealParticipants = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: {
      from: () => {
        const builder = {
          update: (row: Record<string, unknown>) => {
            state.updates.push(row);
            return builder;
          },
          select: () => builder,
          eq: () => builder,
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: [{ id: 'deal-1' }], error: null }),
        };
        return builder;
      },
    },
    accountId: 'acct-1',
    userId: 'agent-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/deals/server', () => ({ actorName: async () => 'Agent' }));
vi.mock('@/lib/deals/participants-server', () => ({
  loadParticipantContacts: async () => (state.knownContacts ? new Map() : null),
  syncDealParticipants,
}));

import { NextRequest } from 'next/server';

import { PUT } from './route';

function put(body: Record<string, unknown>) {
  return PUT(
    new NextRequest('http://localhost/api/deals/deal-1', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'deal-1' }) }
  );
}

const PEOPLE = [
  { contact_id: 'c1', role: 'buyer' },
  { contact_id: 'c2', role: 'agent' },
];

describe('[PIPE-007] PUT /api/deals/[id] with a contact list', () => {
  it('refuses a contact outside the account before the deal is touched', async () => {
    state.knownContacts = false;
    state.updates = [];
    syncDealParticipants.mockReset();
    const res = await put({ title: 'Renamed', participants: PEOPLE });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
    expect(syncDealParticipants).not.toHaveBeenCalled();
  });

  it('saves the deal and then syncs its contacts', async () => {
    state.knownContacts = true;
    state.updates = [];
    syncDealParticipants.mockReset();
    syncDealParticipants.mockResolvedValue({ ok: true });
    const res = await put({ title: 'Renamed', participants: PEOPLE });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ title: 'Renamed' }]);
    expect(syncDealParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: 'deal-1', participants: PEOPLE })
    );
  });

  it('leaves the contacts alone when no list is sent', async () => {
    syncDealParticipants.mockReset();
    const res = await put({ title: 'Renamed again' });
    expect(res.status).toBe(200);
    expect(syncDealParticipants).not.toHaveBeenCalled();
  });
});
