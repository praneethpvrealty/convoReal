import { beforeEach, describe, expect, it, vi } from 'vitest';

const focusNewDealJourney = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'deal-1' }, error: null }),
          }),
        }),
      }),
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

vi.mock('@/lib/deals/new-deal-focus', () => ({ focusNewDealJourney }));

import { POST } from './route';

function create(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/deals', {
      method: 'POST',
      body: JSON.stringify({
        title: 'KP Anand — Koramangala plot',
        pipeline_id: 'pipeline-1',
        stage_id: 'stage-1',
        status: 'open',
        ...body,
      }),
    })
  );
}

beforeEach(() => {
  focusNewDealJourney.mockReset();
  focusNewDealJourney.mockResolvedValue({ mode: 'buyer', subjectId: 'c1' });
});

describe('[TXW-029] POST /api/deals puts the new deal on the Focus board', () => {
  it("moves the new deal's buyer journey into Focus for the caller's account", async () => {
    const res = await create({ contact_id: 'c1', property_id: 'p1' });
    expect(res.status).toBe(201);
    expect(focusNewDealJourney).toHaveBeenCalledTimes(1);
    const [, input] = focusNewDealJourney.mock.calls[0];
    expect(input).toMatchObject({
      accountId: 'acct-1',
      userId: 'agent-1',
      deal: { contact_id: 'c1', property_id: 'p1' },
    });
  });

  it('still creates the deal when the Focus move fails', async () => {
    focusNewDealJourney.mockRejectedValue(new Error('rls denied'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await create({ contact_id: 'c1' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'deal-1' });
    warn.mockRestore();
  });
});
