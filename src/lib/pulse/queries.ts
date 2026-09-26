import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShowcaseEvent, Property, Contact } from '@/types';
import {
  PULSE_FEED_PAGE_SIZE,
  pulseFeedCursorFilter,
  type PulseFeedCursor,
} from './feed-page';

type DB = SupabaseClient;

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export interface PulseStats {
  totalViews: number;
  uniqueSessions: number;
  avgDwellTimeSec: number;
  topProperties: Array<{
    property: {
      id: string;
      title: string;
      property_code: string | null;
      price: number;
    };
    viewsCount: number;
    uniqueViewsCount: number;
  }>;
}

export interface HydratedShowcaseEvent extends Omit<ShowcaseEvent, 'metadata'> {
  metadata: {
    duration_ms?: number;
    query?: string;
    [key: string]: unknown;
  };
  contact?: Contact | null;
  property?: Property | null;
  /** The share-instance link the visit came through, when it did. */
  share?: { id: string; created_at: string } | null;
  /** The contact whose forwarded link brought this guest here. */
  via_contact?: Pick<Contact, 'id' | 'name' | 'phone'> | null;
}

/** Aggregated in Postgres (migration 172) — counting opens, distinct
 *  sessions and dwell in the browser meant downloading every event row
 *  the account has ever logged, twice, with no upper bound. */
export async function loadPulseStats(
  db: DB,
  accountId: string
): Promise<PulseStats> {
  const [statsRes, topRes] = await Promise.all([
    db.rpc('pulse_stats', { p_account_id: accountId }).maybeSingle(),
    db.rpc('pulse_top_properties', { p_account_id: accountId, p_limit: 5 }),
  ]);

  if (statsRes.error) throw statsRes.error;
  if (topRes.error) throw topRes.error;

  const stats = statsRes.data as {
    total_views: number;
    unique_sessions: number;
    avg_dwell_sec: number;
  } | null;

  const topRows = (topRes.data ?? []) as {
    property_id: string;
    title: string;
    property_code: string | null;
    price: number;
    views_count: number;
    unique_views_count: number;
  }[];

  return {
    totalViews: stats?.total_views ?? 0,
    uniqueSessions: stats?.unique_sessions ?? 0,
    avgDwellTimeSec: stats?.avg_dwell_sec ?? 0,
    topProperties: topRows.map((row) => ({
      property: {
        id: row.property_id,
        title: row.title,
        property_code: row.property_code,
        price: row.price,
      },
      viewsCount: row.views_count,
      uniqueViewsCount: row.unique_views_count,
    })),
  };
}

export async function loadPulseFeed(
  db: DB,
  cursor: PulseFeedCursor | null = null
): Promise<HydratedShowcaseEvent[]> {
  let query = db
    .from('showcase_events')
    .select(
      '*, contact:contacts!showcase_events_contact_id_fkey(*), ' +
        'via_contact:contacts!showcase_events_via_contact_id_fkey(id, name, phone), ' +
        'property:properties(*), share:showcase_share_links(id, created_at)'
    );
  if (cursor) query = query.or(pulseFeedCursorFilter(cursor));
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PULSE_FEED_PAGE_SIZE);

  if (error) throw error;

  type ShareRow = { id: string; created_at: string };
  type ViaRow = Pick<Contact, 'id' | 'name' | 'phone'>;
  type EventRow = Omit<ShowcaseEvent, 'contact' | 'property'> & {
    contact: Contact | Contact[] | null;
    via_contact: ViaRow | ViaRow[] | null;
    property: Property | Property[] | null;
    share: ShareRow | ShareRow[] | null;
  };

  return ((data ?? []) as unknown as EventRow[]).map((row) => ({
    ...row,
    metadata: row.metadata as HydratedShowcaseEvent['metadata'],
    contact: one(row.contact),
    via_contact: one(row.via_contact),
    property: one(row.property),
    share: one(row.share),
  })) as HydratedShowcaseEvent[];
}
