import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: Record<string, unknown> | null; error: Error | null };

let results: Record<string, Result>;

vi.mock('./api', () => ({ apiFetch: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => results[table],
      };
      return query;
    },
  },
}));

const { fetchCatalogShareContext } = await import('./catalog-product-share');

beforeEach(() => {
  results = {
    whatsapp_config: { data: { catalog_id: 'c1' }, error: null },
    properties: {
      data: { meta_catalog_synced_at: 't1', meta_catalog_error: null },
      error: null,
    },
    showcase_settings: { data: { currency: 'AED' }, error: null },
  };
});

describe('[PRP-044] fetchCatalogShareContext', () => {
  it('captions in the account currency', async () => {
    await expect(fetchCatalogShareContext('acc-1', 'p1')).resolves.toEqual({
      catalogId: 'c1',
      syncedAt: 't1',
      error: null,
      currency: 'AED',
    });
  });

  it('refuses to guess INR when the currency cannot be read', async () => {
    results.showcase_settings = { data: null, error: new Error('timeout') };
    await expect(fetchCatalogShareContext('acc-1', 'p1')).rejects.toThrow(
      'timeout'
    );
  });

  it.each([
    ['no showcase settings', null],
    ['no currency set', { currency: null }],
  ])('falls back to INR when the account has %s', async (_label, data) => {
    results.showcase_settings = { data, error: null };
    const context = await fetchCatalogShareContext('acc-1', 'p1');
    expect(context.currency).toBe('INR');
  });
});
