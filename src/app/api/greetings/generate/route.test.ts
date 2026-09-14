import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireRole,
  checkRateLimit,
  checkPlanLimit,
  burnCredits,
  refundCredits,
  generateText,
  generateAiImage,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  checkPlanLimit: vi.fn(),
  burnCredits: vi.fn(),
  refundCredits: vi.fn(),
  generateText: vi.fn(),
  generateAiImage: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit,
  rateLimitResponse: () =>
    Response.json({ error: 'Rate limited' }, { status: 429 }),
}));

vi.mock('@/lib/billing/gates', () => ({
  checkPlanLimit,
  gateResponse: () =>
    Response.json({ error: 'Plan upgrade required' }, { status: 402 }),
}));

vi.mock('@/lib/credits/burn', () => ({
  burnCredits,
  refundCredits,
}));

vi.mock('@/lib/ai/gemini', () => ({ generateText }));

vi.mock('@/lib/ai/image-gen', () => ({
  generateAiImage,
  IMAGE_PROVIDER_UNAVAILABLE: 'Image provider unavailable',
}));

vi.mock('@/lib/storage/upload', () => {
  throw new Error('native image processor unavailable');
});

import { POST } from './route';

describe('POST /api/greetings/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({
      accountId: 'account-1',
      userId: 'user-1',
      account: { name: 'Aryavarta Ventures' },
    });
    checkRateLimit.mockResolvedValue({ success: true });
    checkPlanLimit.mockResolvedValue({ allowed: true });
    burnCredits.mockResolvedValue({ success: true });
    generateText.mockResolvedValue('Happy Ganesh Chaturthi!');
    generateAiImage.mockResolvedValue('data:image/png;base64,Y2FyZA==');
  });

  it('can authenticate before loading the optional card uploader', async () => {
    requireRole.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(
      new NextRequest('https://app.convoreal.test/api/greetings/generate', {
        method: 'POST',
        body: JSON.stringify({
          occasion: 'Ganesh Chaturthi',
          tone: 'festive',
          generateImage: true,
        }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns the greeting text when the optional card uploader cannot load', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(
      new NextRequest('https://app.convoreal.test/api/greetings/generate', {
        method: 'POST',
        body: JSON.stringify({
          occasion: 'Ganesh Chaturthi',
          tone: 'festive',
          generateImage: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        text: 'Happy Ganesh Chaturthi!',
        imagePath: null,
        imageUrl: null,
      },
    });
    expect(refundCredits).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
