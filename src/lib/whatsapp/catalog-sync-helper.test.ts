import { beforeEach, describe, expect, it, vi } from 'vitest';

const events: string[] = [];
const updates: Record<string, unknown>[] = [];
let listingType = 'Sale';

vi.mock('@/lib/whatsapp/meta-api', () => ({
  syncProductToCatalog: vi.fn(async () => {
    events.push('sync');
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'token',
}));

const { autoSyncPropertyCatalogIfNeeded, catalogCurrency } =
  await import('./catalog-sync-helper');

function db() {
  return {
    from(table: string) {
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: () => builder,
        eq: () => builder,
        update: (values: unknown) => {
          updates.push(values as Record<string, unknown>);
          events.push('update');
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'whatsapp_config'
                ? {
                    access_token: 'enc',
                    catalog_id: 'c1',
                    auto_sync_catalog: true,
                  }
                : { id: 'p1', listing_type: listingType },
            error: null,
          }),
        then: (resolve: unknown) =>
          Promise.resolve({ data: null, error: null }).then(
            resolve as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

beforeEach(() => {
  events.length = 0;
  updates.length = 0;
  listingType = 'Sale';
});

describe('[PRP-044] autoSyncPropertyCatalogIfNeeded', () => {
  it('clears the previous sync before resyncing, then records the new one', async () => {
    await autoSyncPropertyCatalogIfNeeded(db() as never, 'p1', 'acc-1');
    expect(events).toEqual(['update', 'sync', 'update']);
    expect(updates[0]).toEqual({
      meta_catalog_synced_at: null,
      meta_catalog_error: null,
    });
    expect(updates[1]?.meta_catalog_synced_at).toEqual(expect.any(String));
  });

  it('clears the previous sync of a listing that can no longer be synced', async () => {
    listingType = 'JV/JD';
    await autoSyncPropertyCatalogIfNeeded(db() as never, 'p1', 'acc-1');
    expect(events).toEqual(['update']);
    expect(updates[0]).toEqual({
      meta_catalog_synced_at: null,
      meta_catalog_error: null,
    });
  });
});

describe('[PRP-044] catalogCurrency', () => {
  const settings = (result: { data: unknown; error: unknown }) => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve(result),
      };
      return builder;
    },
  });

  it("uses the account's showcase currency, INR when none is set", async () => {
    await expect(
      catalogCurrency(
        settings({ data: { currency: 'AED' }, error: null }) as never,
        'acc-1'
      )
    ).resolves.toBe('AED');
    await expect(
      catalogCurrency(settings({ data: null, error: null }) as never, 'acc-1')
    ).resolves.toBe('INR');
  });

  it('fails the sync rather than guessing when the currency cannot be read', async () => {
    await expect(
      catalogCurrency(
        settings({ data: null, error: { message: 'timeout' } }) as never,
        'acc-1'
      )
    ).rejects.toThrow('Could not read the account currency: timeout');
  });
});
