import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/account', () => ({
  ForbiddenError: class extends Error {},
  UnauthorizedError: class extends Error {},
  getCurrentAccount: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  SourceNotStoredError,
  findCandidateRates,
  parseNextSourceChunk,
} from './server';

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

function sourceDb(pagesParsed: number) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({
        data: {
          id: 'src-1',
          status: pagesParsed ? 'parsing' : 'uploaded',
          pages_parsed: pagesParsed,
          page_count: 10,
          storage_path: 'KA/1-x.pdf',
        },
        error: null,
      });
      builder.update = (row: Record<string, unknown>) => {
        updates.push(row);
        return builder;
      };
      return builder;
    },
    storage: {
      from: () => ({
        download: async () => ({
          data: null,
          error: { message: 'Object not found' },
        }),
      }),
    },
  } as unknown as SupabaseClient;
  return { db, updates };
}

describe('parseNextSourceChunk', () => {
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
});
