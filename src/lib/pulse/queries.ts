import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShowcaseEvent, Property, Contact } from '@/types';

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
    property: Property;
    viewsCount: number;
    uniqueViewsCount: number;
  }>;
}

export interface HydratedShowcaseEvent extends Omit<ShowcaseEvent, 'metadata'> {
  metadata: {
    duration_ms?: number;
    [key: string]: unknown;
  };
  contact?: Contact | null;
  property?: Property | null;
}

export async function loadPulseStats(db: DB): Promise<PulseStats> {
  const [eventsRes, topPropsRes] = await Promise.all([
    db.from('showcase_events').select('session_key, event_type, metadata'),
    db.from('showcase_events').select('property_id, session_key').not('property_id', 'is', null)
  ]);

  if (eventsRes.error) throw eventsRes.error;
  if (topPropsRes.error) throw topPropsRes.error;

  const events = eventsRes.data ?? [];
  const totalViews = events.length;

  const sessions = new Set(events.map((e) => e.session_key));
  const uniqueSessions = sessions.size;

  let totalDwellMs = 0;
  let dwellCount = 0;
  for (const e of events) {
    if (e.event_type === 'view_property' && e.metadata) {
      const meta = e.metadata as Record<string, unknown>;
      if (typeof meta.duration_ms === 'number') {
        totalDwellMs += meta.duration_ms;
        dwellCount++;
      }
    }
  }
  const avgDwellTimeSec = dwellCount > 0 ? Math.round(totalDwellMs / dwellCount / 1000) : 0;

  const propViews = new Map<string, { views: number; sessions: Set<string> }>();
  for (const p of topPropsRes.data ?? []) {
    const pid = p.property_id;
    if (!pid) continue;
    const current = propViews.get(pid) || { views: 0, sessions: new Set() };
    current.views++;
    current.sessions.add(p.session_key);
    propViews.set(pid, current);
  }

  const sortedProps = Array.from(propViews.entries())
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 5);

  const topProperties: PulseStats['topProperties'] = [];
  if (sortedProps.length > 0) {
    const { data: properties } = await db
      .from('properties')
      .select('*')
      .in('id', sortedProps.map(([id]) => id));

    for (const [id, stats] of sortedProps) {
      const property = properties?.find((p) => p.id === id);
      if (property) {
        topProperties.push({
          property: property as Property,
          viewsCount: stats.views,
          uniqueViewsCount: stats.sessions.size,
        });
      }
    }
  }

  return {
    totalViews,
    uniqueSessions,
    avgDwellTimeSec,
    topProperties,
  };
}

export async function loadPulseFeed(db: DB): Promise<HydratedShowcaseEvent[]> {
  const { data, error } = await db
    .from('showcase_events')
    .select('*, contact:contacts(*), property:properties(*)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  type EventRow = Omit<ShowcaseEvent, 'contact' | 'property'> & {
    contact: Contact | Contact[] | null;
    property: Property | Property[] | null;
  };

  return ((data ?? []) as unknown as EventRow[]).map((row) => ({
    ...row,
    metadata: row.metadata as HydratedShowcaseEvent['metadata'],
    contact: one(row.contact),
    property: one(row.property),
  })) as HydratedShowcaseEvent[];
}
