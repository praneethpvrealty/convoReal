import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchEvent, Contact, Property } from '@/types';

type DB = SupabaseClient;

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * Load all unresolved Match Radar events ('new' status) for the active account.
 * Hydrates the subject property (if kind = 'new_property') or contact (if kind = 'buyer_updated').
 */
export async function loadMatchEvents(db: DB): Promise<MatchEvent[]> {
  const { data, error } = await db
    .from('match_events')
    .select('*, property:properties(*), contact:contacts(*)')
    .eq('status', 'new')
    .order('created_at', { ascending: false });

  if (error) throw error;

  type EventRow = Omit<MatchEvent, 'property' | 'contact'> & {
    property: Property | Property[] | null;
    contact: Contact | Contact[] | null;
  };

  return ((data ?? []) as unknown as EventRow[]).map((row) => ({
    ...row,
    property: one(row.property),
    contact: one(row.contact),
  })) as MatchEvent[];
}

/** Fills in prices on property targets snapshotted before
 *  MatchEventTarget.price existed. Bounded lookup — targets are capped
 *  at 12 per event and events are deduped daily per subject. */
export async function hydrateTargetPrices(db: DB, events: MatchEvent[]): Promise<MatchEvent[]> {
  const missing = [
    ...new Set(
      events
        .filter((e) => e.kind === 'buyer_updated')
        .flatMap((e) => e.matches.filter((m) => m.price === undefined).map((m) => m.id))
    ),
  ].slice(0, 200);
  if (missing.length === 0) return events;

  const { data } = await db.from('properties').select('id, price').in('id', missing);
  const priceById = new Map(
    (data ?? []).map((p) => [p.id as string, p.price != null ? Number(p.price) : null])
  );
  if (priceById.size === 0) return events;

  return events.map((e) =>
    e.kind === 'buyer_updated'
      ? {
          ...e,
          matches: e.matches.map((m) =>
            m.price === undefined && priceById.has(m.id) ? { ...m, price: priceById.get(m.id) } : m
          ),
        }
      : e
  );
}
