import type { SupabaseClient } from '@supabase/supabase-js';
import { daysAgoStart } from '@/lib/dashboard/date-utils';

export interface TeamAnalyticsRow {
  user_id: string;
  full_name: string | null;
  org_role: string | null;
  team_id: string | null;
  team_name: string | null;
  messages_sent: number;
  open_conversations: number;
  conversations_closed: number;
  deals_won: number;
  deals_won_value: number;
  response_samples: number;
  median_response_seconds: number | null;
  avg_response_seconds: number | null;
}

export interface TeamAnalyticsSummary {
  agents: number;
  messagesSent: number;
  openConversations: number;
  conversationsClosed: number;
  dealsWon: number;
  dealsWonValue: number;
  responseSamples: number;
  avgResponseSeconds: number | null;
}

export async function loadTeamAnalytics(
  db: SupabaseClient,
  accountId: string,
  days: number
): Promise<TeamAnalyticsRow[]> {
  const { data, error } = await db.rpc('team_analytics', {
    p_account_id: accountId,
    p_start: daysAgoStart(days).toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as TeamAnalyticsRow[];
}

export function summarizeTeamAnalytics(
  rows: TeamAnalyticsRow[]
): TeamAnalyticsSummary {
  let messagesSent = 0;
  let openConversations = 0;
  let conversationsClosed = 0;
  let dealsWon = 0;
  let dealsWonValue = 0;
  let responseSamples = 0;
  let responseSecondsTotal = 0;

  for (const row of rows) {
    messagesSent += row.messages_sent;
    openConversations += row.open_conversations;
    conversationsClosed += row.conversations_closed;
    dealsWon += row.deals_won;
    dealsWonValue += Number(row.deals_won_value);
    responseSamples += row.response_samples;
    if (row.avg_response_seconds != null) {
      responseSecondsTotal +=
        row.response_samples * Number(row.avg_response_seconds);
    }
  }

  return {
    agents: rows.length,
    messagesSent,
    openConversations,
    conversationsClosed,
    dealsWon,
    dealsWonValue,
    responseSamples,
    avgResponseSeconds:
      responseSamples > 0 ? responseSecondsTotal / responseSamples : null,
  };
}

export function formatResponseSeconds(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}
