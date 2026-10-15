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

const { apiFetch } = await import('./api');
const { fetchCatalogShareContext, sendCatalogProduct } =
  await import('./catalog-product-share');

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

describe('[PRP-048] sendCatalogProduct', () => {
  const property = {
    id: 'p1',
    title: '3 BHK in Koramangala',
    property_code: 'KOR-1',
    price: 45000000,
    status: 'Under Contract',
  } as never;
  const contact = { id: 'c-1', name: 'Yusuf', phone: '+919800000001' } as never;

  function postedBody(): Record<string, unknown> {
    const call = vi.mocked(apiFetch).mock.calls.at(-1);
    expect(call).toBeDefined();
    const init = call?.[1] as { body?: string } | undefined;
    return JSON.parse(init?.body ?? '{}');
  }

  it('asks the broadcast to follow the card with the availability note only when told to', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ results: [] });
    await sendCatalogProduct('c1', 'INR', property, [contact], true);
    expect(postedBody()).toMatchObject({
      broadcast_type: 'product',
      property_id: 'p1',
      availability_note: true,
    });
    await sendCatalogProduct('c1', 'INR', property, [contact]);
    expect(postedBody().availability_note).toBe(false);
  });
});
