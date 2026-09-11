import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { resolveMessageEntityReferences } from './entity-search';

describe('Copilot implicit entity resolution', () => {
  it('resolves a single property code inside the caller account', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      ilike: vi.fn(),
      limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.ilike.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'JP Nagar Plot',
          property_code: 'PROP-1633',
        },
      ],
      error: null,
    });
    const from = vi.fn(() => query);

    const entities = await resolveMessageEntityReferences(
      {
        accountId: 'account-1',
        supabase: { from } as unknown as SupabaseClient,
      },
      'Find the right audience for prop 1633 and share it',
      []
    );

    expect(query.eq).toHaveBeenCalledWith('account_id', 'account-1');
    expect(query.ilike).toHaveBeenCalledWith('property_code', 'PROP-1633');
    expect(entities).toEqual([
      {
        kind: 'property',
        id: '22222222-2222-4222-8222-222222222222',
        label: 'PROP-1633 — JP Nagar Plot',
      },
    ]);
  });

  it('does not guess when more than one property code is named', async () => {
    const from = vi.fn();

    await expect(
      resolveMessageEntityReferences(
        {
          accountId: 'account-1',
          supabase: { from } as unknown as SupabaseClient,
        },
        'Compare PROP-1633 with PROP-1634',
        []
      )
    ).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
