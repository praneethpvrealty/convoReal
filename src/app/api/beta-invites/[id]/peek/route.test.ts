import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkRateLimit, rpc, safeSourceInventoryPreview } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rpc: vi.fn(),
  safeSourceInventoryPreview: vi.fn(),
}));

const maybeSingle = vi.fn();
const admin = {
  rpc,
  from: vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle }),
    }),
  })),
};

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { invitationPeek: {} },
  checkRateLimit,
  rateLimitResponse: () => Response.json({ error: 'limited' }, { status: 429 }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => admin }));
vi.mock('@/lib/agents/source-inventory-preview', () => ({
  safeSourceInventoryPreview,
}));

import { GET } from './route';

describe('GET /api/beta-invites/[id]/peek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ success: true });
    rpc.mockResolvedValue({
      data: {
        ok: true,
        inviter_name: 'Praneeth',
        expires_at: '2026-09-20T00:00:00.000Z',
      },
      error: null,
    });
    maybeSingle.mockResolvedValue({
      data: { invitee_phone: '+919900277111' },
      error: null,
    });
    safeSourceInventoryPreview.mockResolvedValue({
      propertyCount: 4,
      consultantNames: ['Aryavarta Realty'],
    });
  });

  it('adds the inventory benefit without exposing the invited phone number', async () => {
    const response = await GET(new Request('http://test/i/token'), {
      params: Promise.resolve({ id: 'token' }),
    });
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      phone_bound: true,
      inventory_count: 4,
      inventory_consultants: ['Aryavarta Realty'],
    });
    expect(body).not.toHaveProperty('invitee_phone');
    expect(safeSourceInventoryPreview).toHaveBeenCalledWith(
      admin,
      '+919900277111'
    );
  });

  it('does not look up phone-linked inventory for an invalid invite', async () => {
    rpc.mockResolvedValue({
      data: { ok: false, reason: 'not_found' },
      error: null,
    });

    const response = await GET(new Request('http://test/i/bad'), {
      params: Promise.resolve({ id: 'bad' }),
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(admin.from).not.toHaveBeenCalled();
    expect(safeSourceInventoryPreview).not.toHaveBeenCalled();
  });
});
