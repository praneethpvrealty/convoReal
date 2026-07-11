import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * qa-cache tests. The Supabase admin client is stubbed at the
 * @supabase/supabase-js boundary (qa-cache creates its own client),
 * and the Gemini embed call is stubbed via global fetch — the same
 * two seams the module actually crosses.
 */

const h = vi.hoisted(() => ({
  state: {
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    rpcResponse: { data: [] as unknown[], error: null as { message: string } | null },
    insertRows: [] as Record<string, unknown>[],
    insertResponse: {
      data: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } as { id: string } | null,
      error: null as { message: string } | null,
    },
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ fn, args });
      const p = Promise.resolve(h.state.rpcResponse);
      // supabase-js rpc() builders are thenable with .then — the
      // plain promise covers both awaited and fire-and-forget use.
      return p;
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        h.state.insertRows.push(row);
        return {
          select: () => ({
            single: () => Promise.resolve(h.state.insertResponse),
          }),
        };
      },
    }),
  }),
}));

const EMBEDDING = Array.from({ length: 768 }, (_, i) => i / 768);

function stubEmbedFetch(ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ok
        ? new Response(JSON.stringify({ embedding: { values: EMBEDDING } }), {
            status: 200,
          })
        : new Response(JSON.stringify({ error: { message: 'quota' } }), {
            status: 429,
            statusText: 'Too Many Requests',
          }),
    ),
  );
}

const VALID_ROW = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  question: 'what is pulse?',
  reply: 'Pulse shows who viewed your property links.',
  tour_id: null,
  navigate_to: null,
  similarity: 0.95,
};

let qaCache: typeof import('./qa-cache');

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  process.env.GEMINI_API_KEY = 'gemini-key';
  h.state.rpcCalls = [];
  h.state.rpcResponse = { data: [], error: null };
  h.state.insertRows = [];
  h.state.insertResponse = {
    data: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    error: null,
  };
  stubEmbedFetch();
  vi.resetModules();
  qaCache = await import('./qa-cache');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isCacheableQuestion', () => {
  it('accepts a generic first-turn question', () => {
    expect(qaCache.isCacheableQuestion('what is the pulse tab?', 0)).toBe(true);
  });

  it('rejects follow-ups (history present)', () => {
    expect(qaCache.isCacheableQuestion('what about that?', 2)).toBe(false);
  });

  it('rejects PII-looking questions', () => {
    expect(qaCache.isCacheableQuestion('call 9876543210 for me', 0)).toBe(false);
    expect(qaCache.isCacheableQuestion('email me at a@b.com', 0)).toBe(false);
  });

  it('rejects empty and oversized messages', () => {
    expect(qaCache.isCacheableQuestion('   ', 0)).toBe(false);
    expect(qaCache.isCacheableQuestion('x'.repeat(501), 0)).toBe(false);
  });
});

describe('lookupCachedAnswer', () => {
  it('serves a validated hit and reuses the embedding', async () => {
    h.state.rpcResponse = { data: [VALID_ROW], error: null };
    const { entry, embedding } = await qaCache.lookupCachedAnswer('pulse kya hai?');
    expect(entry).toEqual({ id: VALID_ROW.id, reply: VALID_ROW.reply });
    expect(embedding).toEqual(EMBEDDING);
    const call = h.state.rpcCalls.find((c) => c.fn === 'match_copilot_qa');
    expect(call?.args.p_kb_version).toBe(qaCache.KB_VERSION);
    expect(call?.args.p_embedding).toEqual(EMBEDDING);
  });

  it('skips candidates whose tour no longer exists, falls to the next', async () => {
    h.state.rpcResponse = {
      data: [
        { ...VALID_ROW, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tour_id: 'deleted-tour' },
        VALID_ROW,
      ],
      error: null,
    };
    const { entry } = await qaCache.lookupCachedAnswer('pulse?');
    expect(entry?.id).toBe(VALID_ROW.id);
  });

  it('rejects candidates with disallowed navigate_to', async () => {
    h.state.rpcResponse = {
      data: [{ ...VALID_ROW, navigate_to: 'https://evil.example' }],
      error: null,
    };
    const { entry, embedding } = await qaCache.lookupCachedAnswer('pulse?');
    expect(entry).toBeNull();
    expect(embedding).toEqual(EMBEDDING); // still reusable for store
  });

  it('returns null silently when the RPC fails (pre-migration)', async () => {
    h.state.rpcResponse = {
      data: [],
      error: { message: 'function match_copilot_qa does not exist' },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { entry, embedding } = await qaCache.lookupCachedAnswer('pulse?');
    expect(entry).toBeNull();
    expect(embedding).toEqual(EMBEDDING);
    warn.mockRestore();
  });

  it('returns null silently when embedding fails', async () => {
    stubEmbedFetch(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { entry, embedding } = await qaCache.lookupCachedAnswer('pulse?');
    expect(entry).toBeNull();
    expect(embedding).toBeNull();
    expect(h.state.rpcCalls).toHaveLength(0);
    warn.mockRestore();
  });

  it('is a no-op without the service role key', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
    const mod = await import('./qa-cache');
    const { entry, embedding } = await mod.lookupCachedAnswer('pulse?');
    expect(entry).toBeNull();
    expect(embedding).toBeNull();
  });
});

describe('storeAnswer / recordFeedback', () => {
  it('stores a clean answer stamped with the current KB version', async () => {
    const id = await qaCache.storeAnswer({
      question: 'what is pulse?',
      embedding: EMBEDDING,
      reply: 'Pulse shows visitor activity.',
      tourId: 'check-property-views',
    });
    expect(id).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(h.state.insertRows[0]).toMatchObject({
      question: 'what is pulse?',
      tour_id: 'check-property-views',
      navigate_to: null,
      kb_version: qaCache.KB_VERSION,
    });
  });

  it('returns null on insert failure without throwing', async () => {
    h.state.insertResponse = {
      data: null,
      error: { message: 'relation copilot_qa_cache does not exist' },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await qaCache.storeAnswer({
      question: 'q',
      embedding: EMBEDDING,
      reply: 'r',
    });
    expect(id).toBeNull();
    warn.mockRestore();
  });

  it('records votes through the vote RPC', async () => {
    const ok = await qaCache.recordFeedback(VALID_ROW.id, 'down');
    expect(ok).toBe(true);
    expect(h.state.rpcCalls[0]).toEqual({
      fn: 'vote_copilot_qa',
      args: { p_id: VALID_ROW.id, p_up: false },
    });
  });
});

describe('KB_VERSION', () => {
  it('is a stable 12-char hash', () => {
    expect(qaCache.KB_VERSION).toMatch(/^[0-9a-f]{12}$/);
  });
});
