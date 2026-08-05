import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { MatchEvent } from '@shared/types';

/**
 * Web parity: Match Radar (src/lib/radar/queries.ts). Reads go straight
 * through RLS like the web page; sending stays on POST /api/radar/send
 * because channel selection (24h window vs template) is server logic.
 */

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function fetchMatchEvents(): Promise<MatchEvent[]> {
  const { data, error } = await supabase
    .from('match_events')
    .select('*, property:properties(*), contact:contacts(*)')
    .eq('status', 'new')
    .order('created_at', { ascending: false });
  if (error) throw error;

  type Row = Omit<MatchEvent, 'property' | 'contact'> & {
    property: MatchEvent['property'] | MatchEvent['property'][] | null;
    contact: MatchEvent['contact'] | MatchEvent['contact'][] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    ...row,
    property: one(row.property),
    contact: one(row.contact),
  })) as MatchEvent[];
}

export async function dismissMatchEvent(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('match_events')
    .update({ status: 'dismissed' })
    .eq('id', eventId);
  if (error) throw error;
}

export interface RadarSendResult {
  results: Array<{
    id: string;
    status: 'sent' | 'templateMissing' | 'failed';
    error?: string;
  }>;
  sent: number;
  sentViaTemplate: number;
  templateMissing: number;
  failed: number;
  alertTemplateStatus: string | null;
}

export function sendMatchAlert(eventId: string, targetIds: string[]) {
  return apiFetch<RadarSendResult>('/api/radar/send', {
    method: 'POST',
    body: JSON.stringify({ eventId, targetIds }),
  });
}
