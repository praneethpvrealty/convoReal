import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  ForbiddenError: class extends Error {},
  UnauthorizedError: class extends Error {},
  getCurrentAccount: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

const aiFailure = vi.hoisted(() => ({ message: '' }));
const skipPlan = vi.hoisted(() => ({ pages: [] as boolean[] }));
vi.mock('./rate-parse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rate-parse')>()),
  openPdf: async () =>
    skipPlan.pages.length ? { getPageCount: () => 10 } : null,
  parseRatePages: async () => {
    throw new Error(aiFailure.message);
  },
}));
vi.mock('./page-filter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./page-filter')>()),
  pageTexts: () => [],
  planSkippedPages: () => skipPlan.pages,
}));

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  AiUnavailableError,
  SourceInBatchError,
  SourceNotStoredError,
  findCandidateRates,
  parseNextSourceChunk,
} from './server';
import { classifyAiOutage } from './rate-parse';

describe('findCandidateRates', () => {
  it('[GVL-002] never widens a district-scoped search to the whole state', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        calls.push(args);
        return { data: [], error: null };
      },
    } as unknown as SupabaseClient;

    const rates = await findCandidateRates(db, {
      district: 'Mysuru',
      village: 'Hosahalli',
    });

    expect(rates).toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.p_district_pattern).toBe('(mysuru|mysore)');
    }
  });
});

function sourceDb(
  pagesParsed: number,
  stored = false,
  batchId: string | null = null
) {
  const updates: Record<string, unknown>[] = [];
  const orders: string[] = [];
  const db = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.lt = () => builder;
      builder.order = (column: string) => {
        orders.push(column);
        return builder;
      };
      builder.limit = () => builder;
      builder.maybeSingle = async () => ({
        data:
          table === 'guidance_value_rates'
            ? null
            : {
                id: 'src-1',
                status: pagesParsed ? 'parsing' : 'uploaded',
                pages_parsed: pagesParsed,
                page_count: 10,
                storage_path: 'KA/1-x.pdf',
                batch_id: batchId,
              },
        error: null,
      });
      builder.update = (row: Record<string, unknown>) => {
        updates.push(row);
        return builder;
      };
      builder.single = async () => ({
        data: { id: 'src-1', ...updates.at(-1) },
        error: null,
      });
      return builder;
    },
    storage: {
      from: () => ({
        download: async () =>
          stored
            ? {
                data: new Blob([new Uint8Array([37, 80, 68, 70])]),
                error: null,
              }
            : { data: null, error: { message: 'Object not found' } },
      }),
    },
  } as unknown as SupabaseClient;
  return { db, updates, orders };
}

describe('findCandidateRates spelling fallback', () => {
  function rpcDb(byKey: Record<string, unknown>[] = []) {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return {
          data: fn === 'search_guidance_value_rates_by_place_key' ? byKey : [],
          error: null,
        };
      },
    } as unknown as SupabaseClient;
    return { db, calls };
  }

  it('[GVL-013] also looks the village up by its spelling key within the district', async () => {
    const { db, calls } = rpcDb([
      {
        id: 'bima',
        source_id: 's',
        district: 'Mangalore',
        village: 'Bima',
        property_class: 'agricultural',
        rate: 100,
        unit: 'acre',
      },
    ]);
    const rates = await findCandidateRates(db, {
      district: 'Dakshina Kannada',
      village: 'Bheema',
    });
    expect(calls.at(-1)).toEqual({
      fn: 'search_guidance_value_rates_by_place_key',
      args: {
        p_key: 'bim',
        p_district_pattern: '(dakshina kannada|mangalore)'.replace(
          / /g,
          '\\s*'
        ),
        p_limit: 80,
      },
    });
    expect(rates.map((r) => r.id)).toEqual(['bima']);
  });

  it('[GVL-013] never runs the spelling lookup without a district', async () => {
    const { db, calls } = rpcDb();
    await findCandidateRates(db, { village: 'Bheema' });
    expect(calls.map((c) => c.fn)).not.toContain(
      'search_guidance_value_rates_by_place_key'
    );
  });
});

describe('parseNextSourceChunk', () => {
  it('[GVL-018] advances over pages the filter identifies as non-rate without calling Gemini', async () => {
    skipPlan.pages = [
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ];
    try {
      const { db, updates } = sourceDb(0, true);
      const source = await parseNextSourceChunk(db, 'src-1');
      expect(source.pages_parsed).toBe(3);
      expect(updates.at(-1)).toMatchObject({
        pages_parsed: 3,
        page_count: 10,
        status: 'parsing',
        error: null,
      });
      expect(updates.at(-1)).not.toHaveProperty('batch_requested_at');
    } finally {
      skipPlan.pages = [];
    }
  });

  it('[GVL-018] marks a notification ready when only skipped pages remain', async () => {
    skipPlan.pages = [...Array.from({ length: 8 }, () => false), true, true];
    try {
      const { db, updates } = sourceDb(8, true);
      const source = await parseNextSourceChunk(db, 'src-1');
      expect(source.pages_parsed).toBe(10);
      expect(updates.at(-1)).toMatchObject({
        pages_parsed: 10,
        status: 'ready',
        batch_requested_at: null,
      });
    } finally {
      skipPlan.pages = [];
    }
  });

  it('[GVL-012] never reads a source that is queued in a batch', async () => {
    const { db, updates } = sourceDb(4, true, 'batch-1');
    await expect(parseNextSourceChunk(db, 'src-1')).rejects.toBeInstanceOf(
      SourceInBatchError
    );
    expect(updates).toEqual([]);
  });

  it('[GVL-007] reports a source whose upload never landed so it can be re-uploaded', async () => {
    const { db } = sourceDb(0);
    await expect(parseNextSourceChunk(db, 'src-1')).rejects.toBeInstanceOf(
      SourceNotStoredError
    );
  });

  it('treats a missing file mid-parse as an ordinary failure', async () => {
    const { db, updates } = sourceDb(4);
    const err = await parseNextSourceChunk(db, 'src-1').catch((e) => e);
    expect(err).not.toBeInstanceOf(SourceNotStoredError);
    expect(err.message).toMatch(/Object not found/);
    expect(updates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('[GVL-008] leaves the source resumable when Gemini is out of credits', async () => {
    aiFailure.message = 'Your prepayment credits are depleted.';
    const { db, updates } = sourceDb(4, true);
    const err = await parseNextSourceChunk(db, 'src-1').catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.code).toBe('AI_UNAVAILABLE');
    expect(updates.at(-1)).not.toHaveProperty('status');
  });

  it('[GVL-008] reports a Gemini rate limit separately so the run can wait', async () => {
    aiFailure.message = 'Resource has been exhausted (e.g. check quota).';
    const { db } = sourceDb(4, true);
    const err = await parseNextSourceChunk(db, 'src-1').catch((e) => e);
    expect(err.code).toBe('AI_RATE_LIMITED');
  });

  it('still marks an ordinary model error as failed', async () => {
    aiFailure.message = 'Failed to parse Gemini response';
    const { db, updates } = sourceDb(4, true);
    const err = await parseNextSourceChunk(db, 'src-1').catch((e) => e);
    expect(err).not.toBeInstanceOf(AiUnavailableError);
    expect(updates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('never reports a storage quota error as a Gemini outage', async () => {
    const { db, updates } = sourceDb(4);
    (db.storage as unknown as { from: () => { download: unknown } }).from =
      () => ({
        download: async () => ({
          data: null,
          error: { message: 'Storage quota exceeded' },
        }),
      });
    const err = await parseNextSourceChunk(db, 'src-1').catch((e) => e);
    expect(err).not.toBeInstanceOf(AiUnavailableError);
    expect(updates.at(-1)).toMatchObject({ status: 'failed' });
  });
});

describe('classifyAiOutage', () => {
  it('[GVL-008] treats a quota error that mentions billing as a rate limit', () => {
    expect(
      classifyAiOutage(
        'You exceeded your current quota, please check your plan and billing details.'
      )
    ).toBe('rate_limited');
  });

  it('[GVL-008] treats depleted credits and a bad key as unavailable', () => {
    expect(classifyAiOutage('Your prepayment credits are depleted.')).toBe(
      'unavailable'
    );
    expect(
      classifyAiOutage('API key not valid. Please pass a valid key.')
    ).toBe('unavailable');
    expect(classifyAiOutage('Failed to parse Gemini response')).toBeNull();
  });
});

describe('carried headings', () => {
  it('[GVL-009] reads the last saved row by page, then insertion order', async () => {
    aiFailure.message = 'Failed to parse Gemini response';
    const { db, orders } = sourceDb(4, true);
    await parseNextSourceChunk(db, 'src-1').catch(() => null);
    expect(orders).toEqual(['page', 'seq']);
  });
});
