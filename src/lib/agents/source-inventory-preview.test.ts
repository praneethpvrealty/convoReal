import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  EMPTY_SOURCE_INVENTORY_PREVIEW,
  readSourceInventoryPreview,
  safeSourceInventoryPreview,
} from './source-inventory-preview';

function previewClient() {
  return {
    rpc: vi.fn((name: string) =>
      Promise.resolve({
        data:
          name === 'find_agent_source_contacts'
            ? [
                { contact_id: 'contact-a', account_id: 'account-a' },
                { contact_id: 'contact-b', account_id: 'account-b' },
              ]
            : [],
        error: null,
      })
    ),
    from: vi.fn((table: string) => {
      let selection = '';
      const query = {
        select: (columns: string) => {
          selection = columns;
          return query;
        },
        in: () => query,
        eq: () => query,
        is: () => query,
        limit: async () => ({
          data: [
            {
              id: 'property-a',
              account_id: 'account-a',
              owner_contact_id: 'contact-a',
            },
            {
              id: 'property-b',
              account_id: 'account-a',
              owner_contact_id: 'contact-a',
            },
            {
              id: 'property-c',
              account_id: 'account-b',
              owner_contact_id: 'contact-b',
            },
            {
              id: 'wrong-tenant',
              account_id: 'account-b',
              owner_contact_id: 'contact-a',
            },
          ],
          error: null,
        }),
        then: <R>(resolve: (value: unknown) => R | PromiseLike<R>) =>
          Promise.resolve(
            selection === 'id, name'
              ? {
                  data: [
                    { id: 'account-b', name: 'Beta Realty' },
                    { id: 'account-a', name: 'Alpha Properties' },
                  ],
                  error: null,
                }
              : { data: [], error: null }
          ).then(resolve),
      };
      expect(['properties', 'accounts']).toContain(table);
      return query;
    }),
  } as unknown as SupabaseClient;
}

describe('readSourceInventoryPreview', () => {
  it('counts only phone-attributed source listings and orders consultant names by contribution', async () => {
    const result = await readSourceInventoryPreview(
      previewClient(),
      '+91 99002 77111'
    );

    expect(result).toEqual({
      propertyCount: 3,
      consultantNames: ['Alpha Properties', 'Beta Realty'],
    });
  });

  it('does not query the database without a usable phone number', async () => {
    const admin = { rpc: vi.fn() } as unknown as SupabaseClient;
    await expect(readSourceInventoryPreview(admin, null)).resolves.toEqual(
      EMPTY_SOURCE_INVENTORY_PREVIEW
    );
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('includes explicitly shared properties in the invite preview', async () => {
    const admin = {
      rpc: vi.fn((name: string) =>
        Promise.resolve({
          data:
            name === 'find_property_shares_for_phone'
              ? [
                  {
                    property_id: 'property-shared',
                    account_id: 'account-a',
                  },
                ]
              : [],
          error: null,
        })
      ),
      from: vi.fn((table: string) => {
        expect(table).toBe('accounts');
        const query = {
          select: () => query,
          in: () =>
            Promise.resolve({
              data: [{ id: 'account-a', name: 'Alpha Properties' }],
              error: null,
            }),
        };
        return query;
      }),
    } as unknown as SupabaseClient;

    await expect(
      readSourceInventoryPreview(admin, '+919900277111')
    ).resolves.toEqual({
      propertyCount: 1,
      consultantNames: ['Alpha Properties'],
    });
  });

  it('degrades to an empty preview without blocking invite issuance', async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: new Error('database unavailable'),
      }),
    } as unknown as SupabaseClient;

    await expect(
      safeSourceInventoryPreview(admin, '+919900277111')
    ).resolves.toEqual(EMPTY_SOURCE_INVENTORY_PREVIEW);
  });
});
