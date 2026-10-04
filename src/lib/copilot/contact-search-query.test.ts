import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findCopilotContacts } from './contact-search-query';
import { parseContactSearchQuery } from './contact-search';

function clientWith(rows: unknown[] | null, error: { message: string } | null) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('findCopilotContacts', () => {
  const query = parseContactSearchQuery(
    'buyers looking for 3 bhk flats in HSR Layout under 2 cr to buy'
  );

  it('[CPL-003] calls the account-scoped function with the parsed probes', async () => {
    const { client, rpc } = clientWith(
      [
        {
          id: 'c1',
          name: 'Praveen',
          second_name: null,
          company: null,
          classification: 'Buyer',
          min_budget: '10000000',
          max_budget: 20000000,
          matched_area: 'HSR Layout',
          score: 9,
          total: '7',
        },
        {
          id: 'c2',
          name: null,
          second_name: null,
          company: 'Acme Realty',
          classification: null,
          min_budget: null,
          max_budget: null,
          matched_area: null,
          score: 4,
          total: '7',
        },
      ],
      null
    );

    const result = await findCopilotContacts(
      { supabase: client, accountId: 'acct-1' },
      query
    );

    expect(rpc).toHaveBeenCalledWith('copilot_find_contacts', {
      p_account_id: 'acct-1',
      p_area_probes: [['hsr']],
      p_type_probes: ['flat', 'apartment'],
      p_bhk_min: 3,
      p_bhk_max: 3,
      p_budget_min: null,
      p_budget_max: 20_000_000,
      p_listing_types: ['Sale'],
      p_limit: 4,
    });
    expect(result).toEqual({
      total: 7,
      matches: [
        {
          id: 'c1',
          label: 'Praveen',
          classification: 'Buyer',
          budgetMin: 10_000_000,
          budgetMax: 20_000_000,
          matchedArea: 'HSR Layout',
        },
        {
          id: 'c2',
          label: 'Acme Realty',
          classification: null,
          budgetMin: null,
          budgetMax: null,
          matchedArea: null,
        },
      ],
    });
  });

  it('returns an empty result for no rows and surfaces database errors', async () => {
    const empty = clientWith([], null);
    await expect(
      findCopilotContacts({ supabase: empty.client, accountId: 'a' }, query)
    ).resolves.toEqual({ matches: [], total: 0 });

    const failing = clientWith(null, { message: 'function missing' });
    await expect(
      findCopilotContacts({ supabase: failing.client, accountId: 'a' }, query)
    ).rejects.toThrow('function missing');
  });
});
