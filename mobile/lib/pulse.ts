import { supabase } from '@/lib/supabase';
import type { Contact, ShowcaseEvent } from '@/lib/types';

/**
 * Web parity: the Showcase Pulse page (src/lib/pulse/queries.ts +
 * dedupe-feed.ts). The tiles, the top-listings ranking and the viewer
 * roll-up come back pre-aggregated from migration 172 rather than as
 * raw event rows — a phone should not download an account's whole
 * clickstream to count it.
 */

export interface PulseStats {
  totalViews: number;
  uniqueSessions: number;
  avgDwellTimeSec: number;
}

export interface PulseTopProperty {
  propertyId: string;
  title: string;
  propertyCode: string | null;
  price: number | null;
  viewsCount: number;
  uniqueViewsCount: number;
}

export interface PulseEvent extends ShowcaseEvent {
  contact: Pick<Contact, 'id' | 'name' | 'phone' | 'name_tag'> | null;
  property: { id: string; title: string } | null;
}

/** A merged run of consecutive, near-identical events. */
export interface DedupedPulseEvent extends PulseEvent {
  repeatCount: number;
}

export interface PulseViewer {
  contactId: string;
  name: string | null;
  phone: string | null;
  views: number;
  sessions: number;
  lastAt: string;
}

/** Newest events first; the same 100-row window the web timeline shows. */
const FEED_LIMIT = 100;

/** Repeats within this window of each other collapse into one entry —
 *  wide enough to catch double page-loads and bfcache restores, narrow
 *  enough that a visitor genuinely returning hours later still gets its
 *  own timeline row. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function fetchPulseStats(accountId: string): Promise<PulseStats> {
  const { data, error } = await supabase
    .rpc('pulse_stats', { p_account_id: accountId })
    .maybeSingle();
  if (error) throw error;
  const row = data as {
    total_views: number;
    unique_sessions: number;
    avg_dwell_sec: number;
  } | null;
  return {
    totalViews: row?.total_views ?? 0,
    uniqueSessions: row?.unique_sessions ?? 0,
    avgDwellTimeSec: row?.avg_dwell_sec ?? 0,
  };
}

export async function fetchPulseTopProperties(
  accountId: string
): Promise<PulseTopProperty[]> {
  const { data, error } = await supabase.rpc('pulse_top_properties', {
    p_account_id: accountId,
    p_limit: 5,
  });
  if (error) throw error;
  return ((data ?? []) as {
    property_id: string;
    title: string;
    property_code: string | null;
    price: number | null;
    views_count: number;
    unique_views_count: number;
  }[]).map((r) => ({
    propertyId: r.property_id,
    title: r.title,
    propertyCode: r.property_code,
    price: r.price,
    viewsCount: r.views_count,
    uniqueViewsCount: r.unique_views_count,
  }));
}

export async function fetchPulseFeed(): Promise<PulseEvent[]> {
  const { data, error } = await supabase
    .from('showcase_events')
    .select(
      'id, contact_id, property_id, session_key, event_type, metadata, created_at, ' +
        'contact:contacts(id, name, phone, name_tag), property:properties(id, title)'
    )
    .order('created_at', { ascending: false })
    .limit(FEED_LIMIT);
  if (error) throw error;

  type Row = Omit<PulseEvent, 'contact' | 'property'> & {
    contact: PulseEvent['contact'] | PulseEvent['contact'][] | null;
    property: PulseEvent['property'] | PulseEvent['property'][] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    ...row,
    contact: one(row.contact),
    property: one(row.property),
  }));
}

export async function fetchPropertyViewers(
  accountId: string,
  propertyId: string
): Promise<PulseViewer[]> {
  const { data, error } = await supabase.rpc('pulse_property_viewers', {
    p_account_id: accountId,
    p_property_id: propertyId,
  });
  if (error) throw error;
  return ((data ?? []) as {
    contact_id: string;
    name: string | null;
    phone: string | null;
    views_count: number;
    sessions_count: number;
    last_at: string;
  }[]).map((r) => ({
    contactId: r.contact_id,
    name: r.name,
    phone: r.phone,
    views: r.views_count,
    sessions: r.sessions_count,
    lastAt: r.last_at,
  }));
}

/**
 * Collapses consecutive events for the same session + event type +
 * property into a single row with a repeat count. `feed` must be sorted
 * newest-first (as fetchPulseFeed returns it) — the first event in a run
 * is the most recent, so its timestamp is what the merged row keeps.
 */
export function dedupeConsecutiveEvents(feed: PulseEvent[]): DedupedPulseEvent[] {
  const result: DedupedPulseEvent[] = [];

  for (const evt of feed) {
    const prev = result[result.length - 1];
    const samePropertyId = (prev?.property_id ?? null) === (evt.property_id ?? null);
    const withinWindow =
      !!prev &&
      Math.abs(
        new Date(prev.created_at).getTime() - new Date(evt.created_at).getTime()
      ) <= DEDUPE_WINDOW_MS;

    if (
      prev &&
      prev.session_key === evt.session_key &&
      prev.event_type === evt.event_type &&
      samePropertyId &&
      withinWindow
    ) {
      prev.repeatCount += 1;
      continue;
    }

    result.push({ ...evt, repeatCount: 1 });
  }

  return result;
}

/** "45s dwell" / "2m 10s dwell"; empty when the beacon carried no duration. */
export function formatDwellTime(ms?: number): string {
  if (!ms || Number.isNaN(ms)) return '';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s dwell`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m ${remSec}s dwell` : `${min}m dwell`;
}

export function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
