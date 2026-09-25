import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/ai/call-log', () => ({ logAiCall: vi.fn() }));
vi.mock('@/lib/ai/gemini-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/gemini-keys')>()),
  resolveGeminiKeys: async () => [
    {
      id: 'key-1',
      label: 'import-key',
      key: 'AIza-test',
      scope: 'import',
      restingUntil: 0,
      lastError: null,
    },
  ],
}));

import { PDFDocument } from 'pdf-lib';

import {
  parseRatePages,
  RATE_MAX_OUTPUT_TOKENS,
  RATE_READ_TIMEOUT_MS,
} from './rate-parse';

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return doc.save();
}

function reply(page: number, locality: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  groups: [
                    {
                      district: 'Dakshina Kannada',
                      taluk: 'Mangaluru',
                      ...(page === 3
                        ? { hobli: 'Gurupura Hobli', village: 'Addoor' }
                        : {}),
                      rows: [[locality, '', '', 'sqm', page, { rs: 1500 }]],
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    }),
    { status: 200 }
  );
}

function stallingDeadlines() {
  const controllers: AbortController[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  return controllers;
}

describe('parseRatePages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('[GVL-016] reads a stalled two-page range one page at a time', async () => {
    const controllers = stallingDeadlines();
    const prompts: string[] = [];
    const bodies = new Map<string, string>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const asked =
          String(init.body).match(/rates on (pages \d+ to \d+)/)?.[1] ?? '';
        prompts.push(asked);
        bodies.set(asked, String(init.body));
        if (asked === 'pages 3 to 4') {
          setTimeout(() =>
            controllers[0].abort(new DOMException('timed out', 'TimeoutError'))
          );
          return new Promise<Response>((_, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason)
            )
          );
        }
        return asked === 'pages 3 to 3'
          ? reply(3, 'Addoor - Interior')
          : reply(4, 'Adyapadi - Interior');
      })
    );

    const { rows } = await parseRatePages({
      buffer: await pdf(6),
      fromPage: 3,
      toPage: 4,
    });

    expect(prompts).toEqual(['pages 3 to 4', 'pages 3 to 3', 'pages 4 to 4']);
    expect(rows.map((r) => [r.page, r.locality])).toEqual([
      [3, 'Addoor - Interior'],
      [4, 'Adyapadi - Interior'],
    ]);
    expect(bodies.get('pages 4 to 4')).toContain('Gurupura Hobli');
    expect(bodies.get('pages 4 to 4')).toContain('Addoor');
    expect(controllers).toHaveLength(3);
  });

  it('[GVL-016] gives up on a single page that stalls instead of trying every model', async () => {
    const controllers = stallingDeadlines();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          );
          setTimeout(() =>
            controllers
              .at(-1)
              ?.abort(new DOMException('timed out', 'TimeoutError'))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      parseRatePages({ buffer: await pdf(6), fromPage: 5, toPage: 5 })
    ).rejects.toThrow('timed out');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('[GVL-017] reads a range whose output hit the cap one page at a time', async () => {
    stallingDeadlines();
    const prompts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = String(init.body);
        const asked = body.match(/rates on (pages \d+ to \d+)/)?.[1] ?? '';
        prompts.push(asked);
        expect(JSON.parse(body).generationConfig.maxOutputTokens).toBe(
          RATE_MAX_OUTPUT_TOKENS
        );
        if (asked === 'pages 3 to 4') {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: '{"groups":[' }] },
                  finishReason: 'MAX_TOKENS',
                },
              ],
            }),
            { status: 200 }
          );
        }
        return asked === 'pages 3 to 3'
          ? reply(3, 'Addoor - Interior')
          : reply(4, 'Adyapadi - Interior');
      })
    );

    const { rows } = await parseRatePages({
      buffer: await pdf(6),
      fromPage: 3,
      toPage: 4,
    });

    expect(prompts).toEqual(['pages 3 to 4', 'pages 3 to 3', 'pages 4 to 4']);
    expect(rows.map((r) => r.page)).toEqual([3, 4]);
  });

  it('[GVL-016] keeps the deadline under the parse route limit', () => {
    expect(RATE_READ_TIMEOUT_MS * 3).toBeLessThan(300_000);
  });
});
