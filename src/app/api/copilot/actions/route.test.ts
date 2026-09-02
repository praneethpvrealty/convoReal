import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireOrgRole, rpc, checkRateLimit } = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
  rpc: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireOrgRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Forbidden' },
      { status: 403 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit,
  rateLimitResponse: () =>
    Response.json({ error: 'Rate limit exceeded' }, { status: 429 }),
  RATE_LIMITS: { copilotAction: { limit: 12, windowMs: 60_000 } },
}));

import { POST } from './route';

const actionId = '33333333-3333-4333-8333-333333333333';
const entityId = '11111111-1111-4111-8111-111111111111';

function post(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://test/api/copilot/actions', {
      method: 'POST',
      body: JSON.stringify({
        actionId,
        type: 'complete_event',
        entityId,
        platform: 'web',
        ...overrides,
      }),
    })
  );
}

beforeEach(() => {
  rpc.mockReset();
  requireOrgRole.mockReset();
  checkRateLimit.mockReset();
  requireOrgRole.mockResolvedValue({
    userId: 'user-1',
    accountId: 'account-1',
    supabase: { rpc },
  });
  checkRateLimit.mockResolvedValue({ success: true });
});

describe('POST /api/copilot/actions', () => {
  it('executes an authorized event completion with the proposal ID', async () => {
    rpc.mockResolvedValue({
      data: {
        action_id: actionId,
        entity_id: entityId,
        status: 'completed',
        outcome: 'applied',
        replayed: false,
        executed_at: '2026-09-02T09:00:00Z',
      },
      error: null,
    });

    const response = await post({ platform: 'mobile' });

    expect(response.status).toBe(200);
    expect(requireOrgRole).toHaveBeenCalledWith('org_agent');
    expect(rpc).toHaveBeenCalledWith('complete_copilot_appointment', {
      p_appointment_id: entityId,
      p_idempotency_key: actionId,
      p_platform: 'mobile',
    });
    expect(await response.json()).toEqual({
      data: {
        actionId,
        type: 'complete_event',
        entityId,
        status: 'completed',
        outcome: 'applied',
        replayed: false,
        executedAt: '2026-09-02T09:00:00Z',
      },
    });
  });

  it('rejects malformed and unsupported actions before the RPC', async () => {
    const response = await post({ type: 'delete_event' });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the shared rate-limit response', async () => {
    checkRateLimit.mockResolvedValue({ success: false });

    const response = await post();

    expect(response.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not reveal events outside the caller account', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: 'Calendar event not found' },
    });

    const response = await post();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Calendar event not found',
    });
  });

  it('replays a successful idempotency key without a second logical write', async () => {
    rpc.mockResolvedValue({
      data: {
        action_id: actionId,
        entity_id: entityId,
        status: 'completed',
        outcome: 'applied',
        replayed: true,
        executed_at: '2026-09-02T09:00:00Z',
      },
      error: null,
    });

    const response = await post();
    const payload = await response.json();

    expect(payload.data.replayed).toBe(true);
  });

  it('rejects a mismatched database result', async () => {
    rpc.mockResolvedValue({
      data: {
        action_id: actionId,
        entity_id: '55555555-5555-4555-8555-555555555555',
        status: 'completed',
        outcome: 'applied',
        replayed: false,
        executed_at: '2026-09-02T09:00:00Z',
      },
      error: null,
    });

    const response = await post();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not verify the calendar update',
    });
  });
});
