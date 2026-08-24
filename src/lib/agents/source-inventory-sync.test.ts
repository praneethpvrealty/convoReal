import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncAgentSourceInventoryWithAdmin } from './source-inventory-sync';

describe('syncAgentSourceInventoryWithAdmin', () => {
  it('imports inventory attributed to the verified source agent once', async () => {
    const inserted: Record<string, unknown>[] = [];
    const source = {
      id: 'property-a',
      account_id: 'partner-account',
      owner_contact_id: 'source-contact',
      title: 'Agent B land',
      location: 'HSR Layout',
      type: 'Residential Plot',
      price: 25_000_000,
      is_published: false,
      notes: 'partner-only note',
    };
    const admin = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ contact_id: 'source-contact', account_id: 'partner-account' }],
        error: null,
      }),
      from: vi.fn((table: string) => {
        expect(table).toBe('properties');
        let operation: 'source' | 'existing' | 'upsert' = 'source';
        const query = {
          select: (columns: string) => {
            if (columns === 'source_property_id') operation = 'existing';
            if (columns === 'id') operation = 'upsert';
            return query;
          },
          in: () => query,
          eq: () => query,
          is: () => query,
          limit: async () => ({ data: [source], error: null }),
          upsert: (rows: Record<string, unknown>[]) => {
            inserted.push(...rows);
            operation = 'upsert';
            return query;
          },
          then: <R>(resolve: (value: unknown) => R | PromiseLike<R>) => {
            const result =
              operation === 'existing'
                ? { data: [], error: null }
                : operation === 'upsert'
                  ? { data: [{ id: 'copy-a' }], error: null }
                  : { data: [source], error: null };
            return Promise.resolve(result).then(resolve);
          },
        };
        return query;
      }),
    } as unknown as SupabaseClient;

    const result = await syncAgentSourceInventoryWithAdmin(admin, {
      accountId: 'agent-b-account',
      userId: 'agent-b-user',
      phoneLast10: '9900012345',
    });

    expect(result).toEqual({ imported: 1, matched: 1 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      account_id: 'agent-b-account',
      user_id: 'agent-b-user',
      source_property_id: 'property-a',
      owner_contact_id: null,
      listing_source: 'agent',
      is_published: false,
    });
    expect(inserted[0]).not.toHaveProperty('notes');
  });

  it('does not import a source property already present in the target account', async () => {
    const upsert = vi.fn();
    const source = {
      id: 'property-a',
      account_id: 'partner-account',
      owner_contact_id: 'source-contact',
      title: 'Agent B land',
      is_published: true,
    };
    const admin = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ contact_id: 'source-contact', account_id: 'partner-account' }],
        error: null,
      }),
      from: vi.fn(() => {
        let existing = false;
        const query = {
          select: (columns: string) => {
            existing = columns === 'source_property_id';
            return query;
          },
          in: () => query,
          eq: () => query,
          is: () => query,
          limit: async () => ({ data: [source], error: null }),
          upsert,
          then: <R>(resolve: (value: unknown) => R | PromiseLike<R>) =>
            Promise.resolve(
              existing
                ? { data: [{ source_property_id: 'property-a' }], error: null }
                : { data: [source], error: null }
            ).then(resolve),
        };
        return query;
      }),
    } as unknown as SupabaseClient;

    const result = await syncAgentSourceInventoryWithAdmin(admin, {
      accountId: 'agent-b-account',
      userId: 'agent-b-user',
      phoneLast10: '9900012345',
    });

    expect(result).toEqual({ imported: 0, matched: 1 });
    expect(upsert).not.toHaveBeenCalled();
  });
});
