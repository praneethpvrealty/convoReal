import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  fetchInquiredProperties,
  inquiredPropertyLabel,
  type InquiredProperty,
} from './inquired-properties';

const property = (over: Partial<InquiredProperty> = {}): InquiredProperty => ({
  id: 'p-1',
  title: 'Green Acres',
  property_code: 'PROP-1001',
  listing_type: 'Sale',
  inquiry_date: '2026-08-01T00:00:00.000Z',
  inquiry_source: 'Housing',
  ...over,
});

const stubDb = (
  data: unknown,
  error: { message: string } | null = null
) => {
  const calls: { fn?: string; args?: Record<string, unknown> } = {};
  return {
    db: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.fn = fn;
        calls.args = args;
        return Promise.resolve({ data, error });
      },
    } as unknown as SupabaseClient,
    calls,
  };
};

describe('fetchInquiredProperties', () => {
  it('keys the enquiries the RPC reports by contact', async () => {
    const { db, calls } = stubDb([
      { contact_id: 'c-1', properties: [property()] },
      { contact_id: 'c-2', properties: null },
    ]);

    const result = await fetchInquiredProperties(db, 'acc-1', ['c-1', 'c-2']);

    expect(calls.fn).toBe('contacts_inquired_properties');
    expect(calls.args).toEqual({
      p_account_id: 'acc-1',
      p_contact_ids: ['c-1', 'c-2'],
      p_limit: 3,
    });
    expect(result.get('c-1')).toEqual([property()]);
    expect(result.has('c-2')).toBe(false);
  });

  it('asks for nothing when there are no contacts to ask about', async () => {
    const { db, calls } = stubDb([]);
    expect((await fetchInquiredProperties(db, 'acc-1', [])).size).toBe(0);
    expect(calls.fn).toBeUndefined();
  });

  it('degrades to no enquiry history when the lookup fails', async () => {
    const { db } = stubDb(null, { message: 'boom' });
    expect((await fetchInquiredProperties(db, 'acc-1', ['c-1'])).size).toBe(0);
  });
});

describe('inquiredPropertyLabel', () => {
  it('prefers the code, falls back to the title, then to a placeholder', () => {
    expect(inquiredPropertyLabel(property())).toBe('PROP-1001');
    expect(inquiredPropertyLabel(property({ property_code: null }))).toBe(
      'Green Acres'
    );
    expect(
      inquiredPropertyLabel(property({ property_code: null, title: null }))
    ).toBe('Untitled listing');
  });
});
