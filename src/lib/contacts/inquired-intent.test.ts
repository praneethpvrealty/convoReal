import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';

import { attachInquiredListingTypes } from './inquired-intent';

interface StubRow {
  contact_id: string;
  property: { listing_type: string | null } | null;
}

const stubDb = (rows: StubRow[], error: { message: string } | null = null) => {
  const calls: { filtered: boolean; ids?: string[] } = { filtered: false };
  const result = Promise.resolve({ data: rows, error });
  const query = {
    select: () => query,
    eq: () => query,
    in: (_column: string, ids: string[]) => {
      calls.filtered = true;
      calls.ids = ids;
      return query;
    },
    then: (...args: Parameters<typeof result.then>) => result.then(...args),
  };
  return {
    db: { from: () => query } as unknown as SupabaseClient,
    calls,
  };
};

const contact = (id: string): Contact => ({
  id,
  user_id: 'u-1',
  phone: '+919876543210',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe('attachInquiredListingTypes', () => {
  it('collects the distinct listing types a contact enquired about', async () => {
    const { db } = stubDb([
      { contact_id: 'c-1', property: { listing_type: 'Sale' } },
      { contact_id: 'c-1', property: { listing_type: 'Sale' } },
      { contact_id: 'c-2', property: { listing_type: 'Rent' } },
    ]);
    const [first, second] = await attachInquiredListingTypes(db, 'a-1', [
      contact('c-1'),
      contact('c-2'),
    ]);
    expect(first.inquired_listing_types).toEqual(['Sale']);
    expect(second.inquired_listing_types).toEqual(['Rent']);
  });

  it('leaves a contact without enquiries untouched', async () => {
    const { db } = stubDb([]);
    const [only] = await attachInquiredListingTypes(db, 'a-1', [
      contact('c-1'),
    ]);
    expect(only.inquired_listing_types).toBeUndefined();
  });

  // A failed lookup must degrade to the pre-existing behaviour — no
  // intent derived — rather than break the fan-out that called it.
  it('returns the contacts unchanged when the lookup fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = stubDb([], { message: 'boom' });
    const [only] = await attachInquiredListingTypes(db, 'a-1', [
      contact('c-1'),
    ]);
    expect(only.inquired_listing_types).toBeUndefined();
    spy.mockRestore();
  });

  it('filters by contact id for a small batch and by account alone for a large one', async () => {
    const small = stubDb([]);
    await attachInquiredListingTypes(small.db, 'a-1', [contact('c-1')]);
    expect(small.calls.filtered).toBe(true);

    const large = stubDb([]);
    await attachInquiredListingTypes(
      large.db,
      'a-1',
      Array.from({ length: 101 }, (_, i) => contact(`c-${i}`))
    );
    expect(large.calls.filtered).toBe(false);
  });
});
