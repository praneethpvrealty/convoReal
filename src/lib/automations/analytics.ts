import type { SupabaseClient } from '@supabase/supabase-js';
import { daysAgoStart } from '@/lib/dashboard/date-utils';

export interface AutomationAnalyticsRow {
  automation_id: string;
  name: string;
  is_active: boolean;
  trigger_type: string;
  runs: number;
  succeeded: number;
  partial: number;
  failed: number;
  last_run_at: string | null;
}

export interface FlowAnalyticsRow {
  flow_id: string;
  name: string;
  status: string;
  runs: number;
  active_runs: number;
  completed: number;
  handed_off: number;
  timed_out: number;
  paused_by_agent: number;
  failed: number;
  median_duration_seconds: number | null;
  avg_reprompts: number | null;
}

export interface FlowNodeFunnelRow {
  node_key: string;
  node_type: string | null;
  runs_entered: number;
}

export async function loadAutomationAnalytics(
  db: SupabaseClient,
  accountId: string,
  days: number
): Promise<AutomationAnalyticsRow[]> {
  const { data, error } = await db.rpc('automation_analytics', {
    p_account_id: accountId,
    p_start: daysAgoStart(days).toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as AutomationAnalyticsRow[];
}

export async function loadFlowAnalytics(
  db: SupabaseClient,
  accountId: string,
  days: number
): Promise<FlowAnalyticsRow[]> {
  const { data, error } = await db.rpc('flow_analytics', {
    p_account_id: accountId,
    p_start: daysAgoStart(days).toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as FlowAnalyticsRow[];
}

export async function loadFlowNodeFunnel(
  db: SupabaseClient,
  accountId: string,
  flowId: string,
  days: number
): Promise<FlowNodeFunnelRow[]> {
  const { data, error } = await db.rpc('flow_node_funnel', {
    p_account_id: accountId,
    p_flow_id: flowId,
    p_start: daysAgoStart(days).toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as FlowNodeFunnelRow[];
}

export function successRate(
  row: Pick<AutomationAnalyticsRow, 'runs' | 'succeeded'>
): number | null {
  if (row.runs === 0) return null;
  return (row.succeeded / row.runs) * 100;
}

export function completionRate(
  row: Pick<FlowAnalyticsRow, 'runs' | 'completed'>
): number | null {
  if (row.runs === 0) return null;
  return (row.completed / row.runs) * 100;
}

export interface FunnelStep extends FlowNodeFunnelRow {
  pctOfStarted: number;
  dropOffPct: number | null;
}

export function buildFunnelSteps(rows: FlowNodeFunnelRow[]): FunnelStep[] {
  const started = rows[0]?.runs_entered ?? 0;
  return rows.map((row, index) => {
    const prev = index === 0 ? null : rows[index - 1].runs_entered;
    return {
      ...row,
      pctOfStarted: started > 0 ? (row.runs_entered / started) * 100 : 0,
      dropOffPct:
        prev && prev > 0 ? ((prev - row.runs_entered) / prev) * 100 : null,
    };
  });
}

export function formatDurationSeconds(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}
