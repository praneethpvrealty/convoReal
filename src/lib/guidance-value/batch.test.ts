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
import { PDFDocument } from 'pdf-lib';

import { logAiCall } from '@/lib/ai/call-log';
import { OUTPUT_CUT_OFF } from '@/lib/ai/gemini';
import { DEFAULT_PRICING, estimateCostUsd } from '@/lib/ai/keys-admin';

import {
  BATCH_FEATURE,
  assembleSourceRows,
  batchRequest,
  planChunks,
  cronQueueBudgetMs,
  CRON_BUILD_BUDGET_MS,
  pollGuidanceBatches,
  queueGuidanceBatches,
  readBatchOperation,
  type BatchChunk,
} from './batch';
import {
  NON_RATE_TABLE,
  RATE_MAX_OUTPUT_TOKENS,
  sanitiseRateRows,
} from './rate-parse';

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

describe('sanitiseRateRows (land class)', () => {
  it('[GVL-019] keeps the land class of each agricultural column', () => {
    const { rows } = sanitiseRateRows(
      {
        groups: [
          {
            district: 'Dakshina Kannada',
            hobli: 'Gurupura Hobli',
            village: 'Addoor Village',
            rows: [
              [
                'Addoor Village',
                '',
                '',
                'acre',
                126,
                { ad: 952500, aw: 972000, ab: 1106000, ap: 1533000 },
              ],
              ['Old survey land', '', '', 'acre', 126, { ag: 800000 }],
              ['Addoor - Main Road', '', '', 'sqm', 126, { rs: 3500 }],
            ],
          },
        ],
      },
      126,
      126
    );
    expect(
      rows.map((r) => [r.property_class, r.land_class ?? null, r.rate])
    ).toEqual([
      ['agricultural', 'dry', 952500],
      ['agricultural', 'wet', 972000],
      ['agricultural', 'garden', 1106000],
      ['agricultural', 'plantation', 1533000],
      ['agricultural', null, 800000],
      ['residential_site', null, 3500],
    ]);
  });
});

describe('sanitiseRateRows (lakh columns)', () => {
  it('[GVL-021] stores rates printed in lakhs or crores as full rupees', () => {
    const { rows } = sanitiseRateRows(
      {
        groups: [
          {
            village: 'Kallugopahalli',
            rows: [
              [
                'Kallugopahalli',
                '',
                '',
                'lakh/acre',
                218,
                { ad: 55, aw: '65', ab: 12.5 },
              ],
              [
                'Kallugopahalli',
                '',
                '',
                'Rs. in Lakhs per Acre',
                218,
                { ad: 7 },
              ],
              ['Kallugopahalli', '', '', 'crore/hectare', 218, { ag: 1.2 }],
              ['Kallugopahalli', '', '', 'sqm', 218, { rs: 14500 }],
              ['Kallugopahalli', '', '', 'lakh/furlong', 218, { ad: 5 }],
            ],
          },
        ],
      },
      218,
      218
    );
    expect(rows.map((r) => [r.property_class, r.rate, r.unit])).toEqual([
      ['agricultural', 5500000, 'acre'],
      ['agricultural', 6500000, 'acre'],
      ['agricultural', 1250000, 'acre'],
      ['agricultural', 700000, 'acre'],
      ['agricultural', 12000000, 'hectare'],
      ['residential_site', 14500, 'sqm'],
    ]);
  });
});

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

describe('non-rate tables', () => {
  it('[GVL-011] drops ready reckoners, construction, floor and parking tables', () => {
    const { rows } = sanitiseRateRows(
      {
        groups: [
          {
            taluk: 'Statewide',
            village: 'Statewide',
            rows: [['RCC Building', '', '', 'sqm', 3, { ot: 18000 }]],
          },
          {
            village: 'READY RECKONER FOR APARTMENT RATE',
            rows: [['114', '', '', 'sqm', 3, { ra: 11400 }]],
          },
          {
            village: 'Parking Charges',
            rows: [['Up to 50,00,000/-', '', '', 'sqm', 3, { ot: 500 }]],
          },
          {
            village: 'Additional Rate for Apartment Floors',
            rows: [['6th Floor', '', '', 'sqm', 3, { ra: 2 }]],
          },
          {
            village: 'Kallahalli',
            rows: [['', '', '12/1', 'acre', 4, { ag: 900000 }]],
          },
        ],
      },
      3,
      4
    );
    expect(rows.map((r) => [r.village, r.taluk])).toEqual([
      ['Kallahalli', undefined],
    ]);
  });
});

describe('non-rate tables named in rows', () => {
  it('[GVL-011] skips a group whose every line is a non-rate label and carries none of its headings', () => {
    const { rows } = sanitiseRateRows(
      {
        groups: [
          {
            district: 'Belagavi',
            taluk: 'Chikkodi',
            hobli: 'Kasaba',
            village: 'Ankali',
            rows: [['', '', '1/1', 'acre', 3, { ag: 100 }]],
          },
          {
            district: 'Statewide',
            taluk: 'All',
            hobli: 'All',
            village: 'Rates',
            rows: [
              ['Construction Cost', '', '', 'sqm', 3, { ot: 18000 }],
              ['Worked Example', '', '', 'sqm', 3, { ot: 2 }],
            ],
          },
          { rows: [['', '', '2/1', 'acre', 4, { ag: 200 }]] },
        ],
      },
      3,
      4
    );
    expect(rows.map((r) => [r.district, r.village, r.rate])).toEqual([
      ['Belagavi', 'Ankali', 100],
      ['Belagavi', 'Ankali', 200],
    ]);
  });

  it('[GVL-011] recognises the ordinary names of the excluded tables', () => {
    for (const label of [
      'Construction Cost',
      'Worked Example',
      'Building Type',
      'Building Types',
      'Construction Costs',
    ]) {
      expect(NON_RATE_TABLE.test(label)).toBe(true);
    }
    for (const label of ['Koramangala', 'Kallahalli', 'KIADB Area']) {
      expect(NON_RATE_TABLE.test(label)).toBe(false);
    }
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

  it('[GVL-018] turns skipped pages into request-free chunks', () => {
    const skipped = [true, true, false, false, true, false, false];
    expect(planChunks(7, 0, [], skipped)).toEqual([
      { from: 1, to: 2, skipped: true },
      { from: 3, to: 4 },
      { from: 5, to: 5, skipped: true },
      { from: 6, to: 7 },
    ]);
    expect(planChunks(7, 2, [], [true, true, false, true])).toEqual([
      { from: 3, to: 3 },
      { from: 4, to: 4, skipped: true },
      { from: 5, to: 6 },
      { from: 7, to: 7 },
    ]);
  });

  it('[GVL-017] reads a page that overflowed the output cap on its own', () => {
    expect(planChunks(6, 0, [3, 4])).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 3 },
      { from: 4, to: 4 },
      { from: 5, to: 6 },
    ]);
    expect(planChunks(6, 0, [2])).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: 3, to: 4 },
      { from: 5, to: 6 },
    ]);
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
      maxOutputTokens: RATE_MAX_OUTPUT_TOKENS,
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
        cutOff: false,
        promptTokens: 1200,
        responseTokens: 300,
        thoughtTokens: null,
      },
      {
        text: null,
        error: 'Internal error',
        cutOff: false,
        promptTokens: null,
        responseTokens: null,
        thoughtTokens: null,
      },
    ]);
  });

  it('[GVL-017] treats a response that hit the output cap as unread and keeps its thinking tokens', () => {
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
                    {
                      content: { parts: [{ text: '{"groups":[{"rows":[[' }] },
                      finishReason: 'MAX_TOKENS',
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 1200,
                    candidatesTokenCount: 8192,
                    thoughtsTokenCount: 950,
                  },
                },
              },
            ],
          },
        },
      },
    });
    expect(status.results).toEqual([
      {
        text: null,
        error: OUTPUT_CUT_OFF,
        cutOff: true,
        promptTokens: 1200,
        responseTokens: 8192,
        thoughtTokens: 950,
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

  it('[GVL-012] carries the last printed hobli into later ranges of the same taluk', () => {
    const { rows } = assembleSourceRows(0, [
      {
        chunk: chunk(1, 2),
        rows: [
          {
            taluk: 'Kanakapura',
            hobli: 'Maralavadi',
            village: 'Chiliru',
            property_class: 'agricultural',
            rate: 1,
            unit: 'acre',
            page: 2,
          },
        ],
      },
      {
        chunk: chunk(3, 4),
        rows: [
          {
            taluk: 'Kanakapura Taluk',
            village: 'Kiranagere',
            property_class: 'agricultural',
            rate: 2,
            unit: 'acre',
            page: 3,
          },
          {
            taluk: 'Kanakapura',
            hobli: 'Sathanur',
            village: 'Kolalagundi',
            property_class: 'agricultural',
            rate: 3,
            unit: 'acre',
            page: 4,
          },
        ],
      },
      {
        chunk: chunk(5, 6),
        rows: [
          {
            taluk: 'Magadi',
            village: 'Kudur',
            property_class: 'agricultural',
            rate: 4,
            unit: 'acre',
            page: 5,
          },
        ],
      },
    ]);
    expect(rows.map((r) => [r.village, r.hobli])).toEqual([
      ['Chiliru', 'Maralavadi'],
      ['Kiranagere', 'Maralavadi'],
      ['Kolalagundi', 'Sathanur'],
      ['Kudur', undefined],
    ]);
  });

  it('[GVL-012] never carries an old hobli or village into a range that opens a new district', () => {
    const { rows } = assembleSourceRows(0, [
      {
        chunk: chunk(1, 2),
        rows: [
          {
            district: 'Bengaluru Urban',
            hobli: 'Begur',
            village: 'Koramangala',
            locality: 'A',
            property_class: 'residential_site',
            rate: 1,
            unit: 'sqm',
            page: 2,
          },
        ],
      },
      {
        chunk: chunk(3, 4),
        rows: [
          {
            district: 'Bengaluru Rural',
            locality: 'B',
            property_class: 'residential_site',
            rate: 2,
            unit: 'sqm',
            page: 3,
          },
        ],
      },
    ]);
    expect(rows[1]).toMatchObject({
      district: 'Bengaluru Rural',
      locality: 'B',
    });
    expect(rows[1].hobli).toBeUndefined();
    expect(rows[1].village).toBeUndefined();
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

function pollDb(overrides: { chunks?: BatchChunk[] } = {}) {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  const batchRow = {
    id: 'batch-1',
    gemini_name: 'batches/abc',
    key_id: 'key-1',
    key_label: 'praneeku@gmail.com',
    model: 'gemini-3.1-flash-lite',
    state: 'pending',
    chunks: overrides.chunks ?? [chunk(1, 2), chunk(3, 3)],
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

describe('cronQueueBudgetMs', () => {
  it('[GVL-014] gives the cron queue only the time polling left over', () => {
    expect(cronQueueBudgetMs(0, 5_000)).toBe(CRON_BUILD_BUDGET_MS);
    expect(cronQueueBudgetMs(0, 200_000)).toBe(40_000);
    expect(cronQueueBudgetMs(0, 250_000)).toBeLessThan(0);
  });
});

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
    ).toMatchObject({
      pages_parsed: 3,
      batch_id: null,
      error: null,
      batch_requested_at: null,
    });
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

  it('[GVL-018] counts a skipped chunk as read and lines results up with the rest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
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
                                ['7th Block', '', '', 'sqm', 3, { rs: 90 }],
                              ],
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
      )
    );
    const { db, writes } = pollDb({
      chunks: [{ ...chunk(1, 2), skipped: true }, chunk(3, 3)],
    });

    const result = await pollGuidanceBatches(db);

    expect(result).toMatchObject({ applied: 1, failed: 0 });
    const inserted = writes.find(
      (w) => w.table === 'guidance_value_rates' && w.op === 'insert'
    )?.value as Array<Record<string, unknown>>;
    expect(inserted.map((r) => r.page)).toEqual([3]);
    expect(
      writes.find(
        (w) =>
          w.table === 'guidance_value_sources' &&
          (w.value as { status?: string })?.status === 'ready'
      )?.value
    ).toMatchObject({ pages_parsed: 3, batch_id: null });
    expect(vi.mocked(logAiCall)).toHaveBeenCalledTimes(1);
  });

  it('[GVL-017] reads an overflowing range one page at a time on the next run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'batches/abc',
              metadata: {
                state: 'BATCH_STATE_SUCCEEDED',
                output: {
                  inlinedResponses: {
                    inlinedResponses: [
                      {
                        response: {
                          candidates: [
                            {
                              content: { parts: [{ text: '{"groups":[' }] },
                              finishReason: 'MAX_TOKENS',
                            },
                          ],
                          usageMetadata: {
                            promptTokenCount: 1000,
                            candidatesTokenCount: 8192,
                            thoughtsTokenCount: 700,
                          },
                        },
                      },
                      answer(
                        JSON.stringify({
                          groups: [
                            {
                              district: 'Bengaluru Urban',
                              village: 'Koramangala',
                              rows: [
                                ['7th Block', '', '', 'sqm', 3, { rs: 90 }],
                              ],
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
      )
    );
    const { db, writes } = pollDb();

    const result = await pollGuidanceBatches(db);

    expect(result).toMatchObject({ applied: 1 });
    const sourceWrite = writes.find(
      (w) =>
        w.table === 'guidance_value_sources' &&
        'single_pages' in (w.value as Record<string, unknown>)
    )?.value as Record<string, unknown>;
    expect(sourceWrite).toMatchObject({
      single_pages: [1, 2],
      pages_parsed: 0,
      status: 'parsing',
      batch_requested_at: null,
    });
    expect(vi.mocked(logAiCall)).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorMessage: OUTPUT_CUT_OFF,
        responseTokens: 8192,
        thoughtTokens: 700,
      })
    );
  });

  it('[GVL-014] frees the notifications when Gemini reports the batch failed', async () => {
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
    ).toMatchObject({ batch_id: null, batch_requested_at: null });
    expect(
      writes.findLast((w) => w.table === 'guidance_value_batches')?.value
    ).toMatchObject({ state: 'failed', error: 'expired' });
  });
});

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return doc.save();
}

async function queueDb(
  lost: string[],
  opts: {
    downloadFails?: boolean;
    listed?: string[];
    pagesParsed?: number;
  } = {}
) {
  const bytes = await pdf(3);
  const writes: Array<{
    table: string;
    op: string;
    value: unknown;
    id?: string;
  }> = [];
  const filters: string[] = [];
  const db = {
    from: (table: string) => {
      let op = 'select';
      let id: string | undefined;
      let value: unknown;
      const builder: Record<string, unknown> = {};
      for (const method of ['in', 'order', 'limit', 'select']) {
        builder[method] = () => builder;
      }
      builder.is = (column: string, v: unknown) => {
        filters.push(`is:${column}:${String(v)}`);
        return builder;
      };
      builder.not = (column: string, operator: string, v: unknown) => {
        filters.push(`not:${column}:${operator}:${String(v)}`);
        return builder;
      };
      builder.eq = (column: string, v: string) => {
        if (column === 'id') id = v;
        return builder;
      };
      builder.insert = (v: unknown) => {
        op = 'insert';
        value = v;
        return builder;
      };
      builder.update = (v: unknown) => {
        op = 'update';
        value = v;
        return builder;
      };
      builder.delete = () => {
        op = 'delete';
        return builder;
      };
      builder.single = async () => {
        writes.push({ table, op, value });
        return { data: { id: 'batch-1' }, error: null };
      };
      builder.then = (resolve: (v: unknown) => void) => {
        if (op !== 'select') writes.push({ table, op, value, id });
        if (table === 'guidance_value_sources' && op === 'select') {
          resolve({
            data: ['src-1', 'src-2'].map((sid) => ({
              id: sid,
              storage_path: `KA/${sid}.pdf`,
              page_count: 3,
              pages_parsed: opts.pagesParsed ?? 0,
            })),
            error: null,
          });
        } else if (table === 'guidance_value_sources' && op === 'update') {
          resolve({
            data: id && lost.includes(id) ? [] : [{ id }],
            error: null,
          });
        } else {
          resolve({ data: [{ id: 'x' }], error: null });
        }
      };
      return builder;
    },
    storage: {
      from: () => ({
        download: async () =>
          opts.downloadFails
            ? { data: null, error: { message: 'Gateway timeout' } }
            : { data: new Blob([new Uint8Array(bytes)]), error: null },
        list: async () => ({
          data: (opts.listed ?? []).map((name) => ({ name })),
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient;
  return { db, writes, filters };
}

describe('queueGuidanceBatches', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('[GVL-012] submits only the notifications it claimed, so an overlapping run never pays twice', async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(JSON.stringify({ name: 'batches/xyz' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { db, writes } = await queueDb(['src-2']);

    const result = await queueGuidanceBatches(db);

    expect(result).toMatchObject({ batches: 1, sources: 1, requests: 2 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    const keys = body.batch.inputConfig.requests.requests.map(
      (r: { metadata: { key: string } }) => r.metadata.key
    );
    expect(keys).toEqual(['src-1:1-2', 'src-1:3-3']);
    expect(
      writes.findLast(
        (w) => w.table === 'guidance_value_batches' && w.op === 'update'
      )?.value
    ).toMatchObject({ gemini_name: 'batches/xyz', request_count: 2 });
  });

  it('[GVL-014] remembers the queue request on every waiting notification before building', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: 'batches/xyz' }), { status: 200 })
      )
    );
    const { db, writes, filters } = await queueDb([]);
    await queueGuidanceBatches(db);
    expect(writes[0]).toMatchObject({
      table: 'guidance_value_sources',
      op: 'update',
    });
    expect(writes[0].value).toHaveProperty('batch_requested_at');
    expect(filters).not.toContain('not:batch_requested_at:is:null');
  });

  it('[GVL-014] the cron only continues notifications someone asked to batch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: 'batches/xyz' }), { status: 200 })
      )
    );
    const { db, writes, filters } = await queueDb([]);
    await queueGuidanceBatches(db, Date.now, {
      requestedOnly: true,
      budgetMs: 1000,
    });
    expect(filters).toContain('not:batch_requested_at:is:null');
    expect(
      writes.some(
        (w) => (w.value as Record<string, unknown> | null)?.batch_requested_at
      )
    ).toBe(false);
  });

  it('[GVL-012] discards the claim when Gemini refuses the batch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Bad request' } }), {
            status: 400,
          })
      )
    );
    const { db, writes } = await queueDb([]);
    await expect(queueGuidanceBatches(db)).rejects.toThrow('Bad request');
    expect(
      writes.some(
        (w) => w.table === 'guidance_value_batches' && w.op === 'delete'
      )
    ).toBe(true);
  });
});

describe('queueGuidanceBatches downloads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('[GVL-012] reports a never-uploaded PDF only when it is missing and nothing was read', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { db, writes } = await queueDb([], { downloadFails: true });
    const result = await queueGuidanceBatches(db);
    expect(result.skipped.map((s) => s.code)).toEqual([
      'SOURCE_NOT_STORED',
      'SOURCE_NOT_STORED',
    ]);
    expect(
      writes.filter(
        (w) =>
          w.table === 'guidance_value_sources' &&
          (w.value as { status?: string }).status === 'failed'
      )
    ).toHaveLength(2);
  });

  it('[GVL-012] leaves a notification untouched when its stored PDF only fails to download', async () => {
    vi.stubGlobal('fetch', vi.fn());
    for (const opts of [
      { downloadFails: true, listed: ['src-1.pdf', 'src-2.pdf'] },
      { downloadFails: true, pagesParsed: 2 },
    ]) {
      const { db, writes } = await queueDb([], opts);
      const result = await queueGuidanceBatches(db);
      expect(result.skipped.map((s) => s.code)).toEqual([
        'DOWNLOAD_FAILED',
        'DOWNLOAD_FAILED',
      ]);
      expect(
        writes.filter(
          (w) =>
            w.table === 'guidance_value_sources' &&
            !('batch_requested_at' in (w.value as Record<string, unknown>))
        )
      ).toEqual([]);
    }
  });
});
