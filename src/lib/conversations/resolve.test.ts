import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findConversation, resolveConversation } from './resolve';

/**
 * A contact must end up with exactly one thread. The bug this replaces
 * produced five for one contact: the read used `.single()` with no
 * `.limit(1)`, so a pre-existing duplicate answered PGRST116 and every
 * caller treated "too many rows" as "none found" and inserted another.
 */

interface Row {
  id: string;
  created_at: string;
}

/** Records what the resolver asked for, and can fail an insert on cue. */
function fakeDb(opts: {
  rows: Row[];
  /** Rows a racing writer commits between the read and the insert. */
  onInsertConflict?: Row;
}) {
  const reads: Array<{ order?: string; limit?: number }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  let rows = opts.rows;

  const db = {
    from() {
      const state: {
        order?: string;
        limit?: number;
        insert?: Record<string, unknown>;
      } = {};
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: (column: string) => {
          state.order = column;
          return builder;
        },
        limit: (n: number) => {
          state.limit = n;
          return builder;
        },
        insert: (row: Record<string, unknown>) => {
          state.insert = row;
          inserts.push(row);
          return builder;
        },
        maybeSingle: () => {
          reads.push({ order: state.order, limit: state.limit });
          const sorted = [...rows].sort((a, b) =>
            a.created_at.localeCompare(b.created_at)
          );
          // Faithful to PostgREST: without a limit, more than one match
          // is an error rather than a row.
          if (state.limit === undefined && sorted.length > 1) {
            return Promise.resolve({
              data: null,
              error: {
                code: 'PGRST116',
                message: 'more than one row returned',
              },
            });
          }
          return Promise.resolve({ data: sorted[0] ?? null, error: null });
        },
        single: () => {
          if (opts.onInsertConflict) {
            rows = [...rows, opts.onInsertConflict];
            return Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value' },
            });
          }
          const created = {
            id: 'conv-new',
            created_at: '2026-01-03T00:00:00Z',
          };
          rows = [...rows, created];
          return Promise.resolve({
            data: { ...created, ...state.insert },
            error: null,
          });
        },
      };
      return builder;
    },
  };

  return { db: db as unknown as SupabaseClient, reads, inserts };
}

const ARGS = { accountId: 'acc-1', contactId: 'contact-1', userId: 'user-1' };

describe('resolveConversation', () => {
  it('returns the existing thread without inserting', async () => {
    const { db, inserts } = fakeDb({
      rows: [{ id: 'conv-1', created_at: '2026-01-01T00:00:00Z' }],
    });

    const { conversation, created } = await resolveConversation<Row>(db, ARGS);

    expect(conversation?.id).toBe('conv-1');
    expect(created).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it('creates the thread when the contact has none', async () => {
    const { db, inserts } = fakeDb({ rows: [] });

    const { conversation, created } = await resolveConversation<Row>(db, ARGS);

    expect(conversation?.id).toBe('conv-new');
    expect(created).toBe(true);
    expect(inserts).toEqual([
      { account_id: 'acc-1', contact_id: 'contact-1', user_id: 'user-1' },
    ]);
  });

  it('seeds onCreate columns only on the row it creates', async () => {
    const fresh = fakeDb({ rows: [] });
    await resolveConversation<Row>(fresh.db, {
      ...ARGS,
      onCreate: { unread_count: 3 },
    });
    expect(fresh.inserts[0]).toMatchObject({ unread_count: 3 });

    const existing = fakeDb({
      rows: [{ id: 'conv-1', created_at: '2026-01-01T00:00:00Z' }],
    });
    await resolveConversation<Row>(existing.db, {
      ...ARGS,
      onCreate: { unread_count: 3 },
    });
    expect(existing.inserts).toHaveLength(0);
  });

  it('returns the winner rather than a second thread when it loses the insert race', async () => {
    const { db, inserts } = fakeDb({
      rows: [],
      onInsertConflict: {
        id: 'conv-winner',
        created_at: '2026-01-02T00:00:00Z',
      },
    });

    const { conversation, created } = await resolveConversation<Row>(db, ARGS);

    expect(conversation?.id).toBe('conv-winner');
    expect(created).toBe(false);
    expect(inserts).toHaveLength(1);
  });

  it('picks the oldest of pre-existing duplicates instead of adding another', async () => {
    // The runaway: before migration 227 this read errored with PGRST116
    // and the caller inserted a fresh thread for every message.
    const { db, inserts } = fakeDb({
      rows: [
        { id: 'conv-b', created_at: '2026-01-02T00:00:00Z' },
        { id: 'conv-a', created_at: '2026-01-01T00:00:00Z' },
      ],
    });

    const { conversation } = await resolveConversation<Row>(db, ARGS);

    expect(conversation?.id).toBe('conv-a');
    expect(inserts).toHaveLength(0);
  });

  it('reads with a bounded, oldest-first query', async () => {
    const { db, reads } = fakeDb({
      rows: [{ id: 'conv-1', created_at: '2026-01-01T00:00:00Z' }],
    });

    await resolveConversation<Row>(db, ARGS);

    expect(reads[0]).toEqual({ order: 'created_at', limit: 1 });
  });
});

describe('findConversation', () => {
  it('never creates a thread for a caller with nothing to write', async () => {
    const { db, inserts } = fakeDb({ rows: [] });

    const found = await findConversation<Row>(db, {
      accountId: 'acc-1',
      contactId: 'contact-1',
    });

    expect(found).toBeNull();
    expect(inserts).toHaveLength(0);
  });
});
