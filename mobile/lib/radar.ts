import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { MatchEvent, RadarManualContact } from '@shared/types';

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
  const { data, error } = await supabase
    .from('match_events')
    .update({ status: 'dismissed' })
    .eq('id', eventId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('That match is no longer there.');
}

export interface RadarSendResult {
  results: {
    id: string;
    status: 'sent' | 'templateMissing' | 'failed';
    error?: string;
  }[];
  sent: number;
  sentViaTemplate: number;
  templateMissing: number;
  failed: number;
  alertTemplateStatus: string | null;
}

export function searchRadarContacts(eventId: string, query: string) {
  const params = new URLSearchParams({ eventId, q: query });
  return apiFetch<{ data: RadarManualContact[] }>(
    `/api/radar/contacts?${params.toString()}`
  ).then((result) => result.data);
}

/**
 * POST /api/radar/send hands each target to Meta one after another, up
 * to three messages apiece, so nine targets outlast the default 20-second
 * budget while the server is still sending. Scale with the batch and
 * stay under the route's 300-second function limit.
 */
export function matchAlertTimeoutMs(targetCount: number): number {
  return Math.min(60_000 + Math.max(0, targetCount) * 10_000, 280_000);
}

export function sendMatchAlert(
  eventId: string,
  targetIds: string[],
  manualContactIds: string[] = []
) {
  return apiFetch<RadarSendResult>('/api/radar/send', {
    method: 'POST',
    timeoutMs: matchAlertTimeoutMs(targetIds.length),
    body: JSON.stringify({ eventId, targetIds, manualContactIds }),
  });
}
