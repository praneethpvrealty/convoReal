import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, adminAvailable, upserts } = vi.hoisted(() => ({
  store: new Map<string, { value: unknown; expires_at: string }>(),
  adminAvailable: { value: true },
  upserts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    if (!adminAvailable.value) throw new Error('no admin client');
    return {
      from: () => {
        const filters: Record<string, string> = {};
        let now = '';
        const builder = {
          select: () => builder,
          eq(column: string, value: string) {
            filters[column] = value;
            return builder;
          },
          gt(_column: string, value: string) {
            now = value;
            return builder;
          },
          lt(_column: string, value: string) {
            now = value;
            return builder;
          },
          async maybeSingle() {
            const row = store.get(`${filters.kind}|${filters.key}`);
            if (!row || row.expires_at <= now)
              return { data: null, error: null };
            return { data: { value: row.value }, error: null };
          },
          async upsert(row: Record<string, unknown>) {
            upserts.push(row);
            store.set(`${row.kind}|${row.key}`, {
              value: row.value,
              expires_at: row.expires_at as string,
            });
            return { error: null };
          },
          delete: () => builder,
          async then(resolve: (value: unknown) => void) {
            const expired = [...store.entries()].filter(
              ([, row]) => row.expires_at < now
            );
            for (const [key] of expired) store.delete(key);
            resolve({ data: expired.map(() => ({ kind: 'x' })), error: null });
          },
        };
        return builder;
      },
    };
  },
}));

const {
  cachedLookup,
  coordinateLookupKey,
  normalizeLookupKey,
  sweepExpiredLookups,
  LOOKUP_HIT_TTL_MS,
  LOOKUP_MISS_TTL_MS,
  __resetLookupCacheForTests,
} = await import('./lookup-cache');

beforeEach(() => {
  store.clear();
  upserts.length = 0;
  adminAvailable.value = true;
  __resetLookupCacheForTests();
  vi.useRealTimers();
});

describe('cachedLookup', () => {
  it('[PRP-025] runs the fetcher once and serves the second ask from the cache', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ latitude: 12.9, longitude: 77.6 });

    const first = await cachedLookup('geocode', 'hsr layout', fetcher);
    const second = await cachedLookup('geocode', 'hsr layout', fetcher);

    expect(first).toEqual({ latitude: 12.9, longitude: 77.6 });
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('[PRP-025] shares one fetch between concurrent misses on the same key', async () => {
    let release: (value: {
      latitude: number;
      longitude: number;
    }) => void = () => {};
    const answer = new Promise<{ latitude: number; longitude: number }>(
      (resolve) => {
        release = resolve;
      }
    );
    const fetcher = vi.fn(() => answer);

    const asks = Promise.all([
      cachedLookup('geocode', 'hsr layout', fetcher),
      cachedLookup('geocode', 'hsr layout', fetcher),
      cachedLookup('geocode', 'hsr layout', fetcher),
    ]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    release({ latitude: 12.9, longitude: 77.6 });

    expect(await asks).toEqual(
      Array(3).fill({ latitude: 12.9, longitude: 77.6 })
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(upserts).toHaveLength(1);
  });

  it('lets the next ask retry after a shared fetch fails', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ latitude: 1, longitude: 2 });

    const results = await Promise.allSettled([
      cachedLookup('geocode', 'hsr', fetcher),
      cachedLookup('geocode', 'hsr', fetcher),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(await cachedLookup('geocode', 'hsr', fetcher)).toEqual({
      latitude: 1,
      longitude: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps kinds apart so a geocode hit never answers a reverse lookup', async () => {
    const geocode = vi.fn().mockResolvedValue({ latitude: 1, longitude: 2 });
    const reverse = vi.fn().mockResolvedValue({ city: 'Bengaluru' });

    await cachedLookup('geocode', 'same-key', geocode);
    const result = await cachedLookup('reverse-geocode', 'same-key', reverse);

    expect(result).toEqual({ city: 'Bengaluru' });
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it('[PRP-025] caches a definitive miss for a week instead of a month', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-02T00:00:00Z') });
    const fetcher = vi.fn().mockResolvedValue(null);

    expect(await cachedLookup('geocode', 'nowhere', fetcher)).toBeNull();
    expect(await cachedLookup('geocode', 'nowhere', fetcher)).toBeNull();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(upserts[0].expires_at).toBe(
      new Date(Date.now() + LOOKUP_MISS_TTL_MS).toISOString()
    );
  });

  it('stores a hit for the 30 days Google allows', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-02T00:00:00Z') });

    await cachedLookup('geocode', 'hsr', async () => ({
      latitude: 1,
      longitude: 2,
    }));

    expect(upserts[0].expires_at).toBe(
      new Date(Date.now() + LOOKUP_HIT_TTL_MS).toISOString()
    );
  });

  it('refetches once an entry has expired', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-02T00:00:00Z') });
    const fetcher = vi.fn().mockResolvedValue({ latitude: 1, longitude: 2 });

    await cachedLookup('geocode', 'hsr', fetcher);
    vi.setSystemTime(new Date(Date.now() + LOOKUP_HIT_TTL_MS + 1000));
    await cachedLookup('geocode', 'hsr', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not cache a fetcher that throws, so a transient failure is retried', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ latitude: 1, longitude: 2 });

    await expect(cachedLookup('geocode', 'hsr', fetcher)).rejects.toThrow(
      '503'
    );
    expect(await cachedLookup('geocode', 'hsr', fetcher)).toEqual({
      latitude: 1,
      longitude: 2,
    });
    expect(upserts).toHaveLength(1);
  });

  it('fails open when no admin client is configured', async () => {
    adminAvailable.value = false;
    const fetcher = vi.fn().mockResolvedValue({ latitude: 1, longitude: 2 });

    expect(await cachedLookup('geocode', 'hsr', fetcher)).toEqual({
      latitude: 1,
      longitude: 2,
    });
    expect(await cachedLookup('geocode', 'hsr', fetcher)).toEqual({
      latitude: 1,
      longitude: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(upserts).toHaveLength(0);
  });
});

describe('lookup keys', () => {
  it('normalises case and whitespace so the same address shares one entry', () => {
    expect(normalizeLookupKey('  HSR   Layout, Bengaluru ')).toBe(
      'hsr layout, bengaluru'
    );
  });

  it('rounds coordinates to about a metre', () => {
    expect(coordinateLookupKey(12.912345678, 77.644599999)).toBe(
      '12.91235,77.64460'
    );
  });
});

describe('sweepExpiredLookups', () => {
  it('removes only the expired rows', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-02T00:00:00Z') });
    await cachedLookup('geocode', 'fresh', async () => ({
      latitude: 1,
      longitude: 2,
    }));
    await cachedLookup('geocode', 'stale', async () => null);
    vi.setSystemTime(new Date(Date.now() + LOOKUP_MISS_TTL_MS + 1000));

    expect(await sweepExpiredLookups()).toBe(1);
    expect(store.has('geocode|stale')).toBe(false);
    expect(store.has('geocode|fresh')).toBe(true);
  });
});
