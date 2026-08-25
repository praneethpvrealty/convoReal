import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireRole,
  checkRateLimit,
  lookupAgentShareTarget,
  shareInventoryWithAgent,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  lookupAgentShareTarget: vi.fn(),
  shareInventoryWithAgent: vi.fn(),
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
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit,
  rateLimitResponse: () => Response.json({ error: 'limited' }, { status: 429 }),
}));
vi.mock('@/lib/inventory/agent-account-share', () => ({
  lookupAgentShareTarget,
  shareInventoryWithAgent,
}));

import { GET, POST } from './route';

describe('/api/contacts/[id]/share-inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({ accountId: 'a', userId: 'u' });
    checkRateLimit.mockResolvedValue({ success: true });
  });

  it('reports whether the contact has a separate ConvoReal account', async () => {
    lookupAgentShareTarget.mockResolvedValue({
      contact: { name: 'Agent B' },
      recipient: null,
    });
    const response = await GET(new Request('http://test'), {
      params: Promise.resolve({ id: 'contact-b' }),
    });
    await expect(response.json()).resolves.toEqual({
      data: { registered: false, recipientName: 'Agent B' },
    });
  });

  it('passes a bounded property selection to the shared review-queue service', async () => {
    shareInventoryWithAgent.mockResolvedValue({
      registered: true,
      recipientName: 'Agent B',
      sharedCount: 2,
      alreadySharedCount: 0,
      pending: [],
    });
    const response = await POST(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({ property_ids: ['one', 'two', 3] }),
      }),
      { params: Promise.resolve({ id: 'contact-b' }) }
    );

    expect(response.status).toBe(200);
    expect(shareInventoryWithAgent).toHaveBeenCalledWith(
      expect.anything(),
      'contact-b',
      ['one', 'two']
    );
  });
});
