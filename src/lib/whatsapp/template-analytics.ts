import type { SupabaseClient } from '@supabase/supabase-js';
import { daysAgoStart } from '@/lib/dashboard/date-utils';

export interface TemplateAnalyticsRow {
  template_id: string;
  name: string;
  category: string;
  language: string | null;
  status: string;
  quality_score: 'GREEN' | 'YELLOW' | 'RED' | null;
  broadcast_campaigns: number;
  broadcast_sent: number;
  broadcast_delivered: number;
  broadcast_read: number;
  broadcast_replied: number;
  broadcast_failed: number;
  direct_sends: number;
  direct_delivered: number;
  direct_read: number;
  direct_failed: number;
  last_used_at: string | null;
}

export interface TemplateTotals {
  templates: number;
  approved: number;
  totalSends: number;
  broadcastSent: number;
  broadcastReplied: number;
  readRate: number | null;
  replyRate: number | null;
}

export async function loadTemplateAnalytics(
  db: SupabaseClient,
  accountId: string,
  days: number
): Promise<TemplateAnalyticsRow[]> {
  const { data, error } = await db.rpc('template_analytics', {
    p_account_id: accountId,
    p_start: daysAgoStart(days).toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as TemplateAnalyticsRow[];
}

export function rate(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

export function totalSends(row: TemplateAnalyticsRow): number {
  return row.broadcast_sent + row.direct_sends;
}

export function combinedReadRate(row: TemplateAnalyticsRow): number | null {
  return rate(row.broadcast_read + row.direct_read, totalSends(row));
}

export function summarizeTemplates(
  rows: TemplateAnalyticsRow[]
): TemplateTotals {
  let approved = 0;
  let broadcastSent = 0;
  let broadcastRead = 0;
  let broadcastReplied = 0;
  let directSends = 0;
  let directRead = 0;

  for (const row of rows) {
    if (row.status === 'Approved') approved++;
    broadcastSent += row.broadcast_sent;
    broadcastRead += row.broadcast_read;
    broadcastReplied += row.broadcast_replied;
    directSends += row.direct_sends;
    directRead += row.direct_read;
  }

  const sends = broadcastSent + directSends;
  return {
    templates: rows.length,
    approved,
    totalSends: sends,
    broadcastSent,
    broadcastReplied,
    readRate: rate(broadcastRead + directRead, sends),
    replyRate: rate(broadcastReplied, broadcastSent),
  };
}
