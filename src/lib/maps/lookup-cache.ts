/**
 * Shared, durable cache in front of the paid Google Maps lookups.
 *
 * A geocoded address, a reverse-geocoded pin and a showcase area lookup
 * are facts about public geography, identical for every account and
 * stable for weeks, yet each used to cost a Maps API call every time
 * they were asked for — or, for the showcase, every time a Vercel
 * instance started cold with an empty in-memory Map. Entries live in
 * maps_lookup_cache (service-role only, no tenant data) for the 30 days
 * Google's terms allow geocoding results to be cached; a definitive
 * miss is kept for a week so an unresolvable address is not retried on
 * every request either.
 *
 * Fails open: when the table or the admin client is unavailable the
 * lookup simply runs uncached, so a cache outage costs money, never
 * features.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

export const LOOKUP_CACHE_TABLE = 'maps_lookup_cache';
export const LOOKUP_HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOOKUP_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LookupKind = 'geocode' | 'reverse-geocode' | 'near-place';

let unavailable = false;
const inflight = new Map<string, Promise<unknown>>();

function client() {
  if (unavailable) return null;
  try {
    return supabaseAdmin();
  } catch {
    unavailable = true;
    return null;
  }
}

export function normalizeLookupKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function coordinateLookupKey(
  latitude: number,
  longitude: number
): string {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

async function readCached<T>(
  kind: LookupKind,
  key: string
): Promise<T | null | undefined> {
  const db = client();
  if (!db) return undefined;
  try {
    const { data, error } = await db
      .from(LOOKUP_CACHE_TABLE)
      .select('value')
      .eq('kind', kind)
      .eq('key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) {
      console.warn('[maps] lookup cache read failed:', error.message);
      return undefined;
    }
    if (!data) return undefined;
    return (data.value ?? null) as T | null;
  } catch (err) {
    console.warn('[maps] lookup cache read failed:', err);
    return undefined;
  }
}

async function writeCached<T>(
  kind: LookupKind,
  key: string,
  value: T | null
): Promise<void> {
  const db = client();
  if (!db) return;
  const ttl = value === null ? LOOKUP_MISS_TTL_MS : LOOKUP_HIT_TTL_MS;
  try {
    const { error } = await db.from(LOOKUP_CACHE_TABLE).upsert(
      {
        kind,
        key,
        value,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + ttl).toISOString(),
      },
      { onConflict: 'kind,key' }
    );
    if (error) console.warn('[maps] lookup cache write failed:', error.message);
  } catch (err) {
    console.warn('[maps] lookup cache write failed:', err);
  }
}

/**
 * Serves `fetcher`'s answer for (kind, key) from the cache when one is
 * held, otherwise runs it once and stores the result — `null` included,
 * as a shorter-lived miss. A fetcher that throws is not cached, so a
 * transient Google failure is retried next time. Concurrent misses on
 * one key within a process share a single fetch, so a batch that
 * geocodes the same address twenty times over buys it once.
 */
export async function cachedLookup<T>(
  kind: LookupKind,
  key: string,
  fetcher: () => Promise<T | null>
): Promise<T | null> {
  const id = `${kind}|${key}`;
  const pending = inflight.get(id) as Promise<T | null> | undefined;
  if (pending) return pending;
  const run = (async () => {
    const cached = await readCached<T>(kind, key);
    if (cached !== undefined) return cached;
    const value = await fetcher();
    await writeCached(kind, key, value);
    return value;
  })();
  inflight.set(id, run);
  try {
    return await run;
  } finally {
    inflight.delete(id);
  }
}

/** Drops expired rows; run from a daily cron. */
export async function sweepExpiredLookups(): Promise<number> {
  const db = client();
  if (!db) return 0;
  const { data, error } = await db
    .from(LOOKUP_CACHE_TABLE)
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('kind');
  if (error) throw error;
  return data?.length ?? 0;
}

export function __resetLookupCacheForTests(): void {
  unavailable = false;
  inflight.clear();
}
