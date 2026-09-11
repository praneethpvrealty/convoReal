import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkRateLimit, getCurrentAccount, transcribeVoiceNote } = vi.hoisted(
  () => ({
    checkRateLimit: vi.fn(),
    getCurrentAccount: vi.fn(),
    transcribeVoiceNote: vi.fn(),
  })
);

vi.mock('@/lib/ai/gemini', () => ({ transcribeVoiceNote }));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount,
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
  RATE_LIMITS: {
    copilotVoice: { limit: 10, windowMs: 60_000 },
    copilotVoiceDaily: { limit: 60, windowMs: 86_400_000 },
  },
}));

import { POST } from './route';

const recording = Buffer.alloc(300, 1);

function post(base64 = recording.toString('base64')) {
  return POST(
    new Request('http://test/api/copilot/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audio: { base64, mimeType: 'audio/webm' } }),
    })
  );
}

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  checkRateLimit.mockReset();
  getCurrentAccount.mockReset();
  transcribeVoiceNote.mockReset();
  checkRateLimit.mockResolvedValue({ success: true });
  getCurrentAccount.mockResolvedValue({
    userId: 'user-1',
    accountId: 'account-1',
  });
});

describe('POST /api/copilot/transcribe', () => {
  it('returns an editable transcript for web or mobile', async () => {
    transcribeVoiceNote.mockResolvedValue('Open PROP-1633 audience sharing');

    const response = await post();

    expect(response.status).toBe(200);
    expect(transcribeVoiceNote).toHaveBeenCalledWith(recording, 'audio/webm');
    expect(await response.json()).toEqual({
      data: { transcript: 'Open PROP-1633 audience sharing' },
    });
  });

  it('rejects malformed audio before transcription', async () => {
    const response = await post('not-base64');

    expect(response.status).toBe(400);
    expect(transcribeVoiceNote).not.toHaveBeenCalled();
  });

  it('returns a useful retry when no speech was understood', async () => {
    transcribeVoiceNote.mockResolvedValue('');

    const response = await post();

    expect(response.status).toBe(422);
    expect(await response.json()).toHaveProperty('error');
  });
});
