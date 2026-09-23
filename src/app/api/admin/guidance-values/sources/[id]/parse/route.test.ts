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
  return {
    SourceNotStoredError,
    requireGuidanceAdmin: async () => ({ userId: 'admin-1' }),
    parseNextSourceChunk: async () => {
      if (failure) throw failure;
      return { id: 'src-1', status: 'ready' };
    },
  };
});

import { SourceNotStoredError } from '@/lib/guidance-value/server';

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
