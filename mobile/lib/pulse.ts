import type { PulseEvent } from '@/lib/pulse-feed';
import { supabase } from '@/lib/supabase';

/**
 * Web parity: the Showcase Pulse page (src/lib/pulse/queries.ts). The
 * tiles, the top-listings ranking and the viewer roll-up come back
 * pre-aggregated from migration 172 rather than as raw event rows — a
 * phone should not download an account's whole clickstream to count it.
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
      'id, contact_id, property_id, session_key, share_id, event_type, metadata, created_at, ' +
        'contact:contacts(id, name, phone, name_tag), property:properties(id, title), ' +
        'share:showcase_share_links(id, created_at)'
    )
    .order('created_at', { ascending: false })
    .limit(FEED_LIMIT);
  if (error) throw error;

  type Row = Omit<PulseEvent, 'contact' | 'property' | 'share'> & {
    contact: PulseEvent['contact'] | PulseEvent['contact'][] | null;
    property: PulseEvent['property'] | PulseEvent['property'][] | null;
    share: PulseEvent['share'] | PulseEvent['share'][] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    ...row,
    contact: one(row.contact),
    property: one(row.property),
    share: one(row.share),
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
