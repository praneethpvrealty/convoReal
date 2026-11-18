import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRole, checkRateLimit, generateJson, hasGeminiKey } = vi.hoisted(
  () => ({
    requireRole: vi.fn(),
    checkRateLimit: vi.fn(),
    generateJson: vi.fn(),
    hasGeminiKey: vi.fn(),
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
  RATE_LIMITS: { copilotChat: {}, copilotChatDaily: {} },
  checkRateLimit,
  rateLimitResponse: () => Response.json({ error: 'limited' }, { status: 429 }),
}));
vi.mock('@/lib/ai/gemini', () => ({ generateJson }));
vi.mock('@/lib/ai/gemini-keys', () => ({ hasGeminiKey }));

import { POST } from './route';

const briefs = [
  {
    id: 'a1a10000-0000-0000-0000-000000000000',
    name: 'Balamurali',
    requirements: 'Flat in Prestige Meridian',
  },
  {
    id: 'b2b20000-0000-0000-0000-000000000000',
    name: 'Abhishek',
    requirements: '3 BHK in Prestige Meridian Park',
  },
];

function post(body: unknown) {
  return POST(
    new Request('http://test', { method: 'POST', body: JSON.stringify(body) })
  );
}

describe('[REQ-008] POST /api/requirements/consolidate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({ accountId: 'a', userId: 'u' });
    checkRateLimit.mockResolvedValue({ success: true });
    hasGeminiKey.mockResolvedValue(true);
  });

  it('returns the merged text and never shows the model a name', async () => {
    generateJson.mockResolvedValue(
      '```json\n{"groups":[{"keys":["r1","r2"],"looking_for":"3 BHK flat","projects":["Prestige Meridian Park"]}]}\n```'
    );
    const response = await post({ briefs });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        text: [
          '*CLIENT REQUIREMENTS (1, from 2 clients)*',
          '',
          '• 2 clients (REQ-A1A1, REQ-B2B2)',
          '• Looking for: 3 BHK flat',
          '• Projects: Prestige Meridian Park',
        ].join('\n'),
        briefs: 2,
        groups: 1,
        merged: 1,
      },
    });
    const [prompt] = generateJson.mock.calls[0];
    expect(prompt).not.toContain('Balamurali');
    expect(prompt).not.toContain('Abhishek');
  });

  it('refuses fewer than two sendable briefs without calling the model', async () => {
    const response = await post({ briefs: [briefs[0], { id: 'x' }] });
    expect(response.status).toBe(400);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('refuses an oversized list', async () => {
    const response = await post({
      briefs: Array.from({ length: 61 }, (_, i) => ({
        id: `id-${i}`,
        requirements: 'x',
      })),
    });
    expect(response.status).toBe(400);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('is rate limited before any work', async () => {
    checkRateLimit.mockResolvedValue({ success: false });
    expect((await post({ briefs })).status).toBe(429);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('reports an unreadable answer instead of sending nothing', async () => {
    generateJson.mockResolvedValue('not json');
    expect((await post({ briefs })).status).toBe(502);
  });
});
