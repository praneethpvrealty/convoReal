import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRole, checkRateLimit, upsert } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit,
  rateLimitResponse: () => Response.json({ error: 'rate' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

import { PATCH } from './route';

function request(body: unknown) {
  return new Request('http://test/api/showcase/public-profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }) as never;
}

describe('PATCH /api/showcase/public-profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ success: true });
    upsert.mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { public_business_description: 'Advisory' },
            error: null,
          }),
      }),
    });
    requireRole.mockResolvedValue({
      accountId: 'account-1',
      userId: 'admin-1',
      supabase: { from: () => ({ upsert }) },
    });
  });

  it('requires an admin and scopes the upsert to their account', async () => {
    const response = await PATCH(
      request({
        description: ' Advisory ',
        areasServed: [' Bengaluru '],
        propertyExpertise: null,
      })
    );

    expect(response.status).toBe(200);
    expect(requireRole).toHaveBeenCalledWith('admin');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        public_business_description: 'Advisory',
        public_areas_served: ['Bengaluru'],
        public_property_expertise: null,
      }),
      { onConflict: 'account_id' }
    );
  });

  it('rejects malformed values before writing', async () => {
    const response = await PATCH(request({ areasServed: 'Bengaluru' }));
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
