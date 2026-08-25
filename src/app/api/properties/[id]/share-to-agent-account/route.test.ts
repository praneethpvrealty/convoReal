import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRole, checkRateLimit, shareInventoryWithAgent } = vi.hoisted(
  () => ({
    requireRole: vi.fn(),
    checkRateLimit: vi.fn(),
    shareInventoryWithAgent: vi.fn(),
  })
);

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
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
}));

vi.mock('@/lib/inventory/agent-account-share', () => ({
  shareInventoryWithAgent,
}));

import { POST } from './route';

describe('POST /api/properties/[id]/share-to-agent-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({
      accountId: 'sender-account',
      userId: 'sender-user',
    });
    checkRateLimit.mockResolvedValue({ success: true });
  });

  it('keeps the single-property endpoint compatible with the shared service', async () => {
    shareInventoryWithAgent.mockResolvedValue({
      registered: true,
      recipientName: 'Agent B',
      sharedCount: 1,
      alreadySharedCount: 0,
      pending: [
        {
          id: 'pending-copy',
          title: 'Indiranagar Office',
          status: 'Pending Review',
        },
      ],
    });

    const response = await POST(
      new Request(
        'http://test/api/properties/source-property/share-to-agent-account',
        {
          method: 'POST',
          body: JSON.stringify({ contact_id: 'recipient-contact' }),
        }
      ),
      { params: Promise.resolve({ id: 'source-property' }) }
    );

    expect(response.status).toBe(201);
    expect(shareInventoryWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'sender-account' }),
      'recipient-contact',
      ['source-property']
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'pending-copy',
        title: 'Indiranagar Office',
        status: 'Pending Review',
      },
    });
  });

  it('still reports an agent without a separate account', async () => {
    shareInventoryWithAgent.mockResolvedValue({
      registered: false,
      recipientName: 'Agent B',
      sharedCount: 0,
      alreadySharedCount: 0,
      pending: [],
    });

    const response = await POST(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({ contact_id: 'recipient-contact' }),
      }),
      { params: Promise.resolve({ id: 'source-property' }) }
    );

    expect(response.status).toBe(404);
  });
});
