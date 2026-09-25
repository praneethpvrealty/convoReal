import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  ForbiddenError: class extends Error {},
  UnauthorizedError: class extends Error {},
  getCurrentAccount: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/ai/call-log', () => ({ logAiCall: vi.fn() }));
vi.mock('@/lib/ai/gemini-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/gemini-keys')>()),
  resolveGeminiKeys: async () => [
    {
      id: 'key-1',
      label: 'praneeku@gmail.com',
      key: 'AIza-test',
      scope: 'import',
      restingUntil: 0,
      lastError: null,
    },
  ],
}));

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAiCall } from '@/lib/ai/call-log';
import { DEFAULT_PRICING, estimateCostUsd } from '@/lib/ai/keys-admin';

import {
  BATCH_FEATURE,
  assembleSourceRows,
  batchRequest,
  planChunks,
  pollGuidanceBatches,
  readBatchOperation,
  type BatchChunk,
} from './batch';
import { sanitiseRateRows } from './rate-parse';

const compact = {
  total_pages: 12,
  groups: [
    {
      district: 'Bengaluru Urban',
      taluk: 'Jayanagar',
      hobli: 'Begur',
      village: 'Koramangala',
      rows: [
        [
          '6th Block',
          '18th Main',
          '',
          'sqm',
          3,
          { rs: '2,10,000', cs: 350000 },
        ],
        ['6th Block', '', '12/1', 'Sq.Mtr', 4, { ra: 150000, xx: 5 }],
      ],
    },
    {
      village: 'Ejipura',
      rows: [['', '', '', 'sqm', 4, { rs: 90000 }]],
    },
  ],
};

describe('sanitiseRateRows (compact)', () => {
  it('[GVL-011] expands grouped rows into one rate per column, headings written once', () => {
    const { rows, totalPages } = sanitiseRateRows(compact, 3, 4);
    expect(totalPages).toBe(12);
    expect(rows).toEqual([
      {
        district: 'Bengaluru Urban',
        taluk: 'Jayanagar',
        hobli: 'Begur',
        village: 'Koramangala',
        locality: '6th Block',
        road: '18th Main',
        property_class: 'residential_site',
        rate: 210000,
        unit: 'sqm',
        page: 3,
      },
      {
        district: 'Bengaluru Urban',
        taluk: 'Jayanagar',
        hobli: 'Begur',
        village: 'Koramangala',
        locality: '6th Block',
        road: '18th Main',
        property_class: 'commercial_site',
        rate: 350000,
        unit: 'sqm',
        page: 3,
      },
      {
        district: 'Bengaluru Urban',
        taluk: 'Jayanagar',
        hobli: 'Begur',
        village: 'Koramangala',
        locality: '6th Block',
        survey_numbers: '12/1',
        property_class: 'residential_apartment',
        rate: 150000,
        unit: 'sqm',
        page: 4,
      },
      {
        district: 'Bengaluru Urban',
        taluk: 'Jayanagar',
        hobli: 'Begur',
        village: 'Ejipura',
        property_class: 'residential_site',
        rate: 90000,
        unit: 'sqm',
        page: 4,
      },
    ]);
  });

  it('[GVL-011] drops context-page rows and still reads the legacy row format', () => {
    expect(sanitiseRateRows(compact, 4, 4, 3).rows.map((r) => r.page)).toEqual([
      4, 4,
    ]);
    const legacy = sanitiseRateRows(
      {
        rows: [
          {
            village: 'Ejipura',
            property_class: 'residential_site',
            rate: 1,
            unit: 'sqm',
            page: 4,
          },
        ],
      },
      4,
      4
    );
    expect(legacy.rows).toHaveLength(1);
  });
});

describe('planChunks', () => {
  it('[GVL-012] covers every unread page two at a time', () => {
    expect(planChunks(5, 0)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 4 },
      { from: 5, to: 5 },
    ]);
    expect(planChunks(5, 4)).toEqual([{ from: 5, to: 5 }]);
    expect(planChunks(5, 5)).toEqual([]);
  });
});

describe('batchRequest', () => {
  it('[GVL-012] sends the page excerpt with the compact instructions in JSON mode', () => {
    const request = batchRequest(new Uint8Array([37, 80, 68, 70]), 'rules', {
      source_id: 'src-1',
      from_page: 3,
      to_page: 4,
      context_page: 2,
    }) as {
      request: {
        contents: Array<{ parts: Array<Record<string, unknown>> }>;
        systemInstruction: { parts: Array<{ text: string }> };
        generationConfig: Record<string, unknown>;
      };
      metadata: { key: string };
    };
    expect(request.request.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: 'application/pdf', data: 'JVBERg==' },
    });
    expect(request.request.systemInstruction.parts[0].text).toBe('rules');
    expect(request.request.generationConfig).toEqual({
      responseMimeType: 'application/json',
      temperature: 0,
    });
    expect(request.metadata.key).toBe('src-1:3-4');
  });
});

describe('readBatchOperation', () => {
  it('[GVL-012] waits while Gemini is still running the batch', () => {
    expect(
      readBatchOperation({ metadata: { state: 'BATCH_STATE_RUNNING' } }).state
    ).toBe('running');
  });

  it('[GVL-012] reads each response in order, errors included', () => {
    const status = readBatchOperation({
      done: true,
      metadata: {
        state: 'BATCH_STATE_SUCCEEDED',
        output: {
          inlinedResponses: {
            inlinedResponses: [
              {
                response: {
                  candidates: [
                    { content: { parts: [{ text: '{"groups":[]}' }] } },
                  ],
                  usageMetadata: {
                    promptTokenCount: 1200,
                    candidatesTokenCount: 300,
                  },
                },
              },
              { error: { code: 13, message: 'Internal error' } },
            ],
          },
        },
      },
    });
    expect(status.state).toBe('succeeded');
    expect(status.results).toEqual([
      {
        text: '{"groups":[]}',
        error: null,
        promptTokens: 1200,
        responseTokens: 300,
      },
      {
        text: null,
        error: 'Internal error',
        promptTokens: null,
        responseTokens: null,
      },
    ]);
  });

  it('[GVL-012] treats a failed, cancelled or expired batch as failed', () => {
    for (const state of [
      'BATCH_STATE_FAILED',
      'BATCH_STATE_CANCELLED',
      'BATCH_STATE_EXPIRED',
    ]) {
      expect(readBatchOperation({ metadata: { state } }).state).toBe('failed');
    }
    expect(
      readBatchOperation({ done: true, error: { message: 'quota' } }).error
    ).toBe('quota');
  });
});

function chunk(from: number, to: number): BatchChunk {
  return {
    source_id: 'src-1',
    from_page: from,
    to_page: to,
    context_page: from > 1 ? from - 1 : null,
  };
}

describe('assembleSourceRows', () => {
  it('[GVL-012] carries headings across a chunk boundary until the chunk names its own', () => {
    const { rows, parsedTo, failed } = assembleSourceRows(0, [
      {
        chunk: chunk(3, 4),
        rows: [
          {
            locality: 'Cont.',
            property_class: 'residential_site',
            rate: 5,
            unit: 'sqm',
            page: 3,
          },
          {
            village: 'Ejipura',
            hobli: 'Begur',
            locality: 'X',
            property_class: 'residential_site',
            rate: 6,
            unit: 'sqm',
            page: 4,
          },
          {
            locality: 'Y',
            property_class: 'residential_site',
            rate: 7,
            unit: 'sqm',
            page: 4,
          },
        ],
      },
      {
        chunk: chunk(1, 2),
        rows: [
          {
            district: 'Bengaluru Urban',
            village: 'Koramangala',
            hobli: 'Begur',
            locality: 'A',
            property_class: 'residential_site',
            rate: 1,
            unit: 'sqm',
            page: 2,
          },
        ],
      },
    ]);
    expect(parsedTo).toBe(4);
    expect(failed).toBe(0);
    expect(rows.map((r) => [r.locality, r.village, r.district])).toEqual([
      ['A', 'Koramangala', 'Bengaluru Urban'],
      ['Cont.', 'Koramangala', 'Bengaluru Urban'],
      ['X', 'Ejipura', undefined],
      ['Y', undefined, undefined],
    ]);
  });

  it('[GVL-012] only advances progress over pages read without a gap', () => {
    const row = {
      village: 'V',
      property_class: 'residential_site' as const,
      rate: 1,
      unit: 'sqm' as const,
    };
    const result = assembleSourceRows(2, [
      { chunk: chunk(3, 4), rows: [{ ...row, page: 3 }] },
      { chunk: chunk(5, 6), rows: null },
      { chunk: chunk(7, 8), rows: [{ ...row, page: 7 }] },
    ]);
    expect(result.parsedTo).toBe(4);
    expect(result.failed).toBe(1);
    expect(result.rows.map((r) => r.page)).toEqual([3, 7]);
  });
});

describe('batch pricing', () => {
  it('[GVL-012] counts batch calls at half the interactive price', () => {
    const full = estimateCostUsd(
      'gemini-3.1-flash-lite',
      1_000_000,
      1_000_000,
      DEFAULT_PRICING
    );
    expect(
      estimateCostUsd(
        'gemini-3.1-flash-lite',
        1_000_000,
        1_000_000,
        DEFAULT_PRICING,
        BATCH_FEATURE
      )
    ).toBeCloseTo(full / 2);
  });
});

function pollDb() {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  const batchRow = {
    id: 'batch-1',
    gemini_name: 'batches/abc',
    key_id: 'key-1',
    key_label: 'praneeku@gmail.com',
    model: 'gemini-3.1-flash-lite',
    state: 'pending',
    chunks: [chunk(1, 2), chunk(3, 3)],
    updated_at: '2026-09-25T00:00:00Z',
  };
  const db = {
    from: (table: string) => {
      let op = 'select';
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of ['eq', 'in', 'gte', 'lte', 'order', 'limit']) {
        builder[method] = chain;
      }
      builder.select = (_columns?: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          return { eq: async () => ({ count: 3, error: null }) };
        }
        return builder;
      };
      builder.update = (value: unknown) => {
        op = 'update';
        writes.push({ table, op, value });
        return builder;
      };
      builder.delete = () => {
        op = 'delete';
        writes.push({ table, op, value: null });
        return builder;
      };
      builder.insert = async (value: unknown) => {
        writes.push({ table, op: 'insert', value });
        return { error: null };
      };
      builder.maybeSingle = async () => ({
        data: {
          id: 'src-1',
          district: 'Bengaluru Urban',
          taluk: null,
          page_count: 3,
          pages_parsed: 0,
        },
        error: null,
      });
      builder.then = (resolve: (value: unknown) => void) => {
        if (table === 'guidance_value_batches' && op === 'select') {
          resolve({ data: [batchRow], error: null });
        } else if (op === 'update') {
          resolve({ data: [{ id: 'x' }], error: null });
        } else {
          resolve({ data: null, error: null });
        }
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, writes };
}

function answer(text: string) {
  return {
    response: {
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 },
    },
  };
}

describe('pollGuidanceBatches', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('[GVL-012] saves a finished batch and marks the notification ready', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            name: 'batches/abc',
            metadata: {
              state: 'BATCH_STATE_SUCCEEDED',
              output: {
                inlinedResponses: {
                  inlinedResponses: [
                    answer(
                      JSON.stringify({
                        groups: [
                          {
                            district: 'Bengaluru Urban',
                            village: 'Koramangala',
                            rows: [
                              ['6th Block', '', '', 'sqm', 2, { rs: 100 }],
                            ],
                          },
                        ],
                      })
                    ),
                    answer(
                      JSON.stringify({
                        groups: [
                          {
                            rows: [['7th Block', '', '', 'sqm', 3, { rs: 90 }]],
                          },
                        ],
                      })
                    ),
                  ],
                },
              },
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { db, writes } = pollDb();

    const result = await pollGuidanceBatches(db);

    expect(result).toMatchObject({ checked: 1, applied: 1, failed: 0 });
    expect(fetchMock.mock.calls[0][0]).toContain('/v1beta/batches/abc');
    const inserted = writes.find(
      (w) => w.table === 'guidance_value_rates' && w.op === 'insert'
    )?.value as Array<Record<string, unknown>>;
    expect(inserted.map((r) => [r.locality, r.village, r.page])).toEqual([
      ['6th Block', 'Koramangala', 2],
      ['7th Block', 'Koramangala', 3],
    ]);
    expect(
      writes.find(
        (w) =>
          w.table === 'guidance_value_sources' &&
          (w.value as { status?: string })?.status === 'ready'
      )?.value
    ).toMatchObject({ pages_parsed: 3, batch_id: null, error: null });
    expect(
      writes.findLast((w) => w.table === 'guidance_value_batches')?.value
    ).toMatchObject({ state: 'applied', failed_count: 0 });
    expect(vi.mocked(logAiCall)).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: BATCH_FEATURE,
        promptTokens: 1000,
        responseTokens: 200,
      })
    );
  });

  it('[GVL-012] frees the notifications when Gemini reports the batch failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ metadata: { state: 'BATCH_STATE_EXPIRED' } }),
            { status: 200 }
          )
      )
    );
    const { db, writes } = pollDb();
    const result = await pollGuidanceBatches(db);
    expect(result.failed).toBe(1);
    expect(
      writes.find((w) => w.table === 'guidance_value_sources')?.value
    ).toMatchObject({ batch_id: null });
    expect(
      writes.findLast((w) => w.table === 'guidance_value_batches')?.value
    ).toMatchObject({ state: 'failed', error: 'expired' });
  });
});
