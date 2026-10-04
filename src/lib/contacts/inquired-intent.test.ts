import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';

import { attachInquiredListingTypes } from './inquired-intent';

interface IntentRow {
  contact_id: string;
  listing_types: string[] | null;
}

interface PriceRow {
  contact_id: string;
  prices: (number | string)[] | null;
}

const stubDb = (
  rows: IntentRow[],
  error: { message: string } | null = null,
  priceRows: PriceRow[] = [],
  priceError: { message: string } | null = null
) => {
  const calls: { args?: Record<string, unknown>; fns: string[] } = {
    fns: [],
  };
  return {
    db: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.fns.push(fn);
        if (fn === 'contacts_inquired_prices') {
          return Promise.resolve({ data: priceRows, error: priceError });
        }
        calls.args = args;
        return Promise.resolve({ data: rows, error });
      },
    } as unknown as SupabaseClient,
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
  it('collects the listing types the RPC reports per contact', async () => {
    const { db, calls } = stubDb([
      { contact_id: 'c-1', listing_types: ['Sale'] },
      { contact_id: 'c-2', listing_types: ['Rent', 'Sale'] },
    ]);
    const [first, second] = await attachInquiredListingTypes(db, 'a-1', [
      contact('c-1'),
      contact('c-2'),
    ]);
    expect(first.inquired_listing_types).toEqual(['Sale']);
    expect(second.inquired_listing_types).toEqual(['Rent', 'Sale']);
    // The ids travel in the RPC body, so a large batch is never a long URL.
    expect(calls.args).toEqual({
      p_account_id: 'a-1',
      p_contact_ids: ['c-1', 'c-2'],
    });
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

  it('[INB-029] collects the prices of the listings each contact enquired about', async () => {
    const { db, calls } = stubDb(
      [{ contact_id: 'c-1', listing_types: ['Sale'] }],
      null,
      [
        { contact_id: 'c-1', prices: ['147000000', 60000000] },
        { contact_id: 'c-2', prices: [35000000] },
      ]
    );
    const [first, second] = await attachInquiredListingTypes(db, 'a-1', [
      contact('c-1'),
      contact('c-2'),
    ]);
    expect(calls.fns).toContain('contacts_inquired_prices');
    expect(first.inquired_listing_types).toEqual(['Sale']);
    expect(first.inquired_prices).toEqual([147000000, 60000000]);
    expect(second.inquired_listing_types).toBeUndefined();
    expect(second.inquired_prices).toEqual([35000000]);
  });

  it('keeps the listing types when only the price lookup fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = stubDb(
      [{ contact_id: 'c-1', listing_types: ['Sale'] }],
      null,
      [],
      { message: 'function does not exist' }
    );
    const [only] = await attachInquiredListingTypes(db, 'a-1', [
      contact('c-1'),
    ]);
    expect(only.inquired_listing_types).toEqual(['Sale']);
    expect(only.inquired_prices).toBeUndefined();
    spy.mockRestore();
  });
});
