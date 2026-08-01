-- ============================================================
-- 182_automation_flow_analytics_rpc.sql
-- Aggregates over the automation and flow execution history, which
-- until now was only visible as raw scrollable log lists
-- (/automations/[id]/logs and /flows/[id]/runs).
--
--   automation_analytics — per automation: run/outcome counts from
--     automation_logs (success | partial | failed) in the range.
--   flow_analytics       — per flow: runs by terminal status, median
--     duration of ended runs, and mean reprompts per run.
--   flow_node_funnel     — distinct runs that entered each node of
--     one flow, from flow_run_events.node_entered — the drop-off
--     analysis flow_run_events.node_key was designed to enable.
--
-- All three take the account explicitly and guard with
-- is_account_member (SECURITY DEFINER pattern of migrations 168-170);
-- flow_node_funnel additionally scopes through flow_runs.account_id
-- since flow_run_events carries no account_id of its own.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_automation_logs_account_created
  ON automation_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_runs_account_flow_started
  ON flow_runs(account_id, flow_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.automation_analytics(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  automation_id UUID,
  name TEXT,
  is_active BOOLEAN,
  trigger_type TEXT,
  runs BIGINT,
  succeeded BIGINT,
  partial BIGINT,
  failed BIGINT,
  last_run_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    a.is_active,
    a.trigger_type,
    count(l.id),
    count(l.id) FILTER (WHERE l.status = 'success'),
    count(l.id) FILTER (WHERE l.status = 'partial'),
    count(l.id) FILTER (WHERE l.status = 'failed'),
    max(l.created_at)
  FROM automations a
  LEFT JOIN automation_logs l
    ON l.automation_id = a.id
   AND l.account_id = p_account_id
   AND l.created_at >= p_start
  WHERE a.account_id = p_account_id
    AND is_account_member(p_account_id)
  GROUP BY a.id, a.name, a.is_active, a.trigger_type
  ORDER BY count(l.id) DESC, a.name;
$$;

CREATE OR REPLACE FUNCTION public.flow_analytics(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  flow_id UUID,
  name TEXT,
  status TEXT,
  runs BIGINT,
  active_runs BIGINT,
  completed BIGINT,
  handed_off BIGINT,
  timed_out BIGINT,
  paused_by_agent BIGINT,
  failed BIGINT,
  median_duration_seconds NUMERIC,
  avg_reprompts NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id,
    f.name,
    f.status,
    count(r.id),
    count(r.id) FILTER (WHERE r.status = 'active'),
    count(r.id) FILTER (WHERE r.status = 'completed'),
    count(r.id) FILTER (WHERE r.status = 'handed_off'),
    count(r.id) FILTER (WHERE r.status = 'timed_out'),
    count(r.id) FILTER (WHERE r.status = 'paused_by_agent'),
    count(r.id) FILTER (WHERE r.status = 'failed'),
    percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (r.ended_at - r.started_at))
    ) FILTER (WHERE r.ended_at IS NOT NULL),
    avg(r.reprompt_count) FILTER (WHERE r.id IS NOT NULL)
  FROM flows f
  LEFT JOIN flow_runs r
    ON r.flow_id = f.id
   AND r.account_id = p_account_id
   AND r.started_at >= p_start
  WHERE f.account_id = p_account_id
    AND is_account_member(p_account_id)
  GROUP BY f.id, f.name, f.status
  ORDER BY count(r.id) DESC, f.name;
$$;

CREATE OR REPLACE FUNCTION public.flow_node_funnel(
  p_account_id UUID,
  p_flow_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  node_key TEXT,
  node_type TEXT,
  runs_entered BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.node_key,
    n.node_type,
    count(DISTINCT e.flow_run_id)
  FROM flow_run_events e
  JOIN flow_runs r
    ON r.id = e.flow_run_id
   AND r.account_id = p_account_id
   AND r.flow_id = p_flow_id
   AND r.started_at >= p_start
  LEFT JOIN flow_nodes n
    ON n.flow_id = p_flow_id
   AND n.node_key = e.node_key
  WHERE e.event_type = 'node_entered'
    AND e.node_key IS NOT NULL
    AND is_account_member(p_account_id)
  GROUP BY e.node_key, n.node_type
  ORDER BY count(DISTINCT e.flow_run_id) DESC, e.node_key;
$$;

COMMENT ON FUNCTION public.automation_analytics(UUID, TIMESTAMPTZ) IS
  'Per-automation run/outcome counts from automation_logs for one account and range. Membership-guarded.';
COMMENT ON FUNCTION public.flow_analytics(UUID, TIMESTAMPTZ) IS
  'Per-flow run counts by terminal status, median ended-run duration and mean reprompts for one account and range. Membership-guarded.';
COMMENT ON FUNCTION public.flow_node_funnel(UUID, UUID, TIMESTAMPTZ) IS
  'Distinct runs entering each node of one flow (node_entered events), for drop-off analysis. Membership-guarded and scoped through flow_runs.account_id.';

REVOKE ALL ON FUNCTION public.automation_analytics(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.flow_analytics(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.flow_node_funnel(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.automation_analytics(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flow_analytics(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flow_node_funnel(UUID, UUID, TIMESTAMPTZ) TO authenticated;
