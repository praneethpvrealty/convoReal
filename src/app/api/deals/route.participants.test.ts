import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  appointment: { id: 'appt-1' } as { id: string } | null,
  appointmentUpdates: [] as Record<string, unknown>[],
  knownContacts: true,
}));
const syncDealParticipants = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: {
      from: (table: string) => {
        const builder = {
          insert: (row: Record<string, unknown>) => {
            state.inserted = row;
            return builder;
          },
          update: (row: Record<string, unknown>) => {
            state.appointmentUpdates.push(row);
            return builder;
          },
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({
            data: table === 'appointments' ? state.appointment : null,
            error: null,
          }),
          single: async () => ({ data: { id: 'deal-1' }, error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: [{ id: 'appt-1' }], error: null }),
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
vi.mock('@/lib/deals/stage-move', () => ({
  resolveStage: async () => ({ name: 'Enquiry', stage_type: 'open' }),
}));
vi.mock('@/lib/inventory/listing-status-sync', () => ({
  setListingStatusFromDeal: async () => true,
}));
vi.mock('@/lib/deals/new-deal-focus', () => ({
  focusNewDealJourney: async () => null,
}));
vi.mock('@/lib/deals/server', () => ({ actorName: async () => 'Agent' }));
vi.mock('@/lib/deals/participants-server', () => ({
  loadParticipantContacts: async () => (state.knownContacts ? new Map() : null),
  syncDealParticipants,
}));

import { POST } from './route';

function create(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/deals', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Commercial Building — Ashwath',
        pipeline_id: 'pipeline-1',
        stage_id: 'stage-1',
        status: 'open',
        ...body,
      }),
    })
  );
}

beforeEach(() => {
  state.inserted = null;
  state.appointment = { id: 'appt-1' };
  state.appointmentUpdates = [];
  state.knownContacts = true;
  syncDealParticipants.mockReset();
  syncDealParticipants.mockResolvedValue({ ok: true, added: 3 });
});

const PEOPLE = [
  { contact_id: 'victor', role: 'agent' },
  { contact_id: 'ashwath', role: 'buyer' },
  { contact_id: 'nimmy', role: 'seller' },
];

describe('[PIPE-007] POST /api/deals saves every contact on the deal', () => {
  it('stores the named contact on the deal and all of them as stakeholders', async () => {
    const res = await create({ contact_id: 'victor', participants: PEOPLE });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'deal-1',
      participants_saved: true,
    });
    expect(state.inserted).toMatchObject({ contact_id: 'victor' });
    expect(syncDealParticipants).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        dealId: 'deal-1',
        participants: PEOPLE,
      })
    );
  });

  it('takes the first buyer as the deal contact when none is named', async () => {
    await create({ participants: PEOPLE });
    expect(state.inserted).toMatchObject({ contact_id: 'ashwath' });
  });

  it('writes no stakeholder for a lone buyer', async () => {
    const res = await create({
      participants: [{ contact_id: 'ashwath', role: 'buyer' }],
    });
    expect(await res.json()).toEqual({ id: 'deal-1' });
    expect(syncDealParticipants).not.toHaveBeenCalled();
  });

  it('refuses a contact from another account before creating anything', async () => {
    state.knownContacts = false;
    const res = await create({ participants: PEOPLE });
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('refuses a role that is not buyer, seller or agent', async () => {
    const res = await create({
      participants: [{ contact_id: 'c1', role: 'witness' }],
    });
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });
});

describe('[CAL-022] POST /api/deals connects the new deal to its calendar event', () => {
  it('links the event to the deal it was created from', async () => {
    const res = await create({
      contact_id: 'ashwath',
      participants: PEOPLE,
      appointment_id: 'appt-1',
    });
    expect(await res.json()).toMatchObject({
      id: 'deal-1',
      appointment_linked: true,
    });
    expect(state.appointmentUpdates).toEqual([{ deal_id: 'deal-1' }]);
  });

  it("creates nothing for an event that is not the caller's", async () => {
    state.appointment = null;
    const res = await create({ contact_id: 'c1', appointment_id: 'other' });
    expect(res.status).toBe(404);
    expect(state.inserted).toBeNull();
  });
});
