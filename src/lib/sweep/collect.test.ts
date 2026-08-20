import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CLOSED_LISTING_STATUS_FILTER } from '@/lib/inventory/listing-status';
import { excludeOwnerSideThreads } from './collect';
import type { SweepThread } from './types';

/**
 * A `properties` query that returns the given owner_contact_id rows,
 * asserting nothing about how many filters were chained onto it.
 */
function dbReturning(
  rows: { owner_contact_id: string | null }[] | null,
  error: unknown = null
): { db: SupabaseClient; calls: Record<string, unknown> } {
  const calls: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls[name] = args.length === 1 ? args[0] : args;
      return builder;
    });

  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.in = vi.fn((col: string, list: unknown[]) => {
    calls.inColumn = col;
    calls.inList = list;
    return builder;
  });
  builder.not = vi.fn((...args: unknown[]) => {
    calls.not = args;
    return Promise.resolve({ data: rows, error });
  });

  const db = { from: chain('from') } as unknown as SupabaseClient;
  return { db, calls };
}

function thread(contactId: string | null, name = 'X'): SweepThread {
  return {
    accountId: 'acc-1',
    channel: 'client',
    contactId,
    contactName: name,
    conversationId: `conv-${contactId}`,
    assignedAgentId: null,
    propertyId: null,
    messages: [],
  };
}

describe('excludeOwnerSideThreads', () => {
  it('drops a contact who owns a live listing', async () => {
    // The Jyoti case: an owner receiving her listing's activity digest
    // was raised as a buyer "sent nothing".
    const { db } = dbReturning([{ owner_contact_id: 'jyoti' }]);
    const out = await excludeOwnerSideThreads(db, 'acc-1', [
      thread('jyoti'),
      thread('buyer-1'),
    ]);
    expect(out.map((t) => t.contactId)).toEqual(['buyer-1']);
  });

  it('keeps everyone when the account owns no listings through contacts', async () => {
    const { db } = dbReturning([]);
    const out = await excludeOwnerSideThreads(db, 'acc-1', [
      thread('buyer-1'),
      thread('buyer-2'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('ignores closed listings, so a former owner is swept again', async () => {
    // Once the flat is sold its owner is an ordinary contact — the same
    // rule every other scanning sender uses.
    const { db, calls } = dbReturning([]);
    await excludeOwnerSideThreads(db, 'acc-1', [thread('someone')]);
    expect(calls.not).toEqual(['status', 'in', CLOSED_LISTING_STATUS_FILTER]);
  });

  it('scopes the lookup to the threads it was given', async () => {
    const { db, calls } = dbReturning([]);
    await excludeOwnerSideThreads(db, 'acc-1', [
      thread('a'),
      thread('b'),
      thread('a'),
    ]);
    // Deduped, and bounded by the thread list rather than unbounded.
    expect(calls.inColumn).toBe('owner_contact_id');
    expect(calls.inList).toEqual(['a', 'b']);
  });

  it('does not query at all when no thread has a contact', async () => {
    const { db, calls } = dbReturning([]);
    const out = await excludeOwnerSideThreads(db, 'acc-1', [thread(null)]);
    expect(out).toHaveLength(1);
    expect(calls.from).toBeUndefined();
  });

  it('fails OPEN — a lookup error sweeps everyone rather than no one', async () => {
    // The cost of failing open is a false owner-side gap someone
    // dismisses. Failing closed would silently sweep nothing at all.
    const { db } = dbReturning(null, { message: 'boom' });
    const out = await excludeOwnerSideThreads(db, 'acc-1', [
      thread('a'),
      thread('b'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps a thread with no contact even when owners exist', async () => {
    const { db } = dbReturning([{ owner_contact_id: 'owner-1' }]);
    const out = await excludeOwnerSideThreads(db, 'acc-1', [
      thread(null),
      thread('owner-1'),
    ]);
    expect(out.map((t) => t.contactId)).toEqual([null]);
  });
});
