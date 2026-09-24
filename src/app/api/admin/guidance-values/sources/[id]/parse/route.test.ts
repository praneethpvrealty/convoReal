import { describe, expect, it, vi } from 'vitest';

let failure: Error | null = null;

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 403 }),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

vi.mock('@/lib/guidance-value/server', async () => {
  class SourceNotStoredError extends Error {
    readonly code = 'SOURCE_NOT_STORED' as const;
  }
  class AiUnavailableError extends Error {
    readonly code: string;
    constructor(message: string, rateLimited: boolean) {
      super(message);
      this.code = rateLimited ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE';
    }
  }
  return {
    AiUnavailableError,
    SourceNotStoredError,
    requireGuidanceAdmin: async () => ({ userId: 'admin-1' }),
    parseNextSourceChunk: async () => {
      if (failure) throw failure;
      return { id: 'src-1', status: 'ready' };
    },
  };
});

import {
  AiUnavailableError,
  SourceNotStoredError,
} from '@/lib/guidance-value/server';

import { POST } from './route';

function parse() {
  return POST(new Request('http://test', { method: 'POST' }), {
    params: Promise.resolve({ id: 'src-1' }),
  });
}

describe('POST /api/admin/guidance-values/sources/[id]/parse', () => {
  it('[GVL-007] answers 409 SOURCE_NOT_STORED when the PDF never landed', async () => {
    failure = new SourceNotStoredError();
    const res = await parse();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SOURCE_NOT_STORED');
  });

  it('[GVL-008] answers 503 AI_UNAVAILABLE when Gemini billing is exhausted', async () => {
    failure = new AiUnavailableError(
      'Your prepayment credits are depleted.',
      false
    );
    const res = await parse();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('AI_UNAVAILABLE');
  });

  it('[GVL-008] answers 429 AI_RATE_LIMITED for a Gemini rate limit', async () => {
    failure = new AiUnavailableError('Resource has been exhausted', true);
    const res = await parse();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('AI_RATE_LIMITED');
  });

  it('answers 502 for other parse failures', async () => {
    failure = new Error('model down');
    expect((await parse()).status).toBe(502);
  });

  it('returns the updated source', async () => {
    failure = null;
    const res = await parse();
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('ready');
  });
});
