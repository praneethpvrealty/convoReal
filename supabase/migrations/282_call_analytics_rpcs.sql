-- Call analytics — aggregates over contact_call_logs and
-- outreach_followups for the Call Analytics dashboard tab.
--
-- SECURITY DEFINER so the aggregates run without per-row RLS
-- evaluation, with the membership check done once up front. A
-- non-member gets zero rows rather than another account's totals: the
-- guard sits in the WHERE clause, and `is_account_member` is STABLE,
-- so Postgres evaluates it a single time.

CREATE OR REPLACE FUNCTION public.call_analytics_summary(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  total BIGINT,
  connected BIGINT,
  no_answer BIGINT,
  busy BIGINT,
  voicemail BIGINT,
  wrong_number BIGINT,
  callback_requested BIGINT,
  voice_agent BIGINT,
  manual BIGINT,
  inbound BIGINT,
  outbound BIGINT,
  avg_duration_seconds NUMERIC,
  total_duration_seconds BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE l.outcome = 'connected'),
    count(*) FILTER (WHERE l.outcome = 'no_answer'),
    count(*) FILTER (WHERE l.outcome = 'busy'),
    count(*) FILTER (WHERE l.outcome = 'voicemail'),
    count(*) FILTER (WHERE l.outcome = 'wrong_number'),
    count(*) FILTER (WHERE l.outcome = 'callback_requested'),
    count(*) FILTER (WHERE l.source = 'voice_agent'),
    count(*) FILTER (WHERE l.source = 'manual'),
    count(*) FILTER (WHERE l.direction = 'inbound'),
    count(*) FILTER (WHERE l.direction = 'outbound'),
    avg(l.duration_seconds) FILTER (WHERE l.outcome = 'connected'),
    COALESCE(sum(l.duration_seconds), 0)::BIGINT
  FROM contact_call_logs l
  WHERE l.account_id = p_account_id
    AND l.called_at >= p_start
    AND is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.call_analytics_summary(UUID, TIMESTAMPTZ) IS
  'Call volume, outcome and duration counters for one account in a single scan. Average duration is over connected calls only.';

CREATE OR REPLACE FUNCTION public.call_analytics_series(
  p_account_id UUID,
  p_start TIMESTAMPTZ,
  p_time_zone TEXT
)
RETURNS TABLE (day DATE, total BIGINT, connected BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (l.called_at AT TIME ZONE p_time_zone)::date AS day,
    count(*),
    count(*) FILTER (WHERE l.outcome = 'connected')
  FROM contact_call_logs l
  WHERE l.account_id = p_account_id
    AND l.called_at >= p_start
    AND is_account_member(p_account_id)
  GROUP BY 1
  ORDER BY 1;
$$;

COMMENT ON FUNCTION public.call_analytics_series(UUID, TIMESTAMPTZ, TEXT) IS
  'Calls per day for one account, bucketed in the viewer''s time zone so the chart''s days match their calendar.';

CREATE OR REPLACE FUNCTION public.call_analytics_dispositions(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  disposition TEXT,
  calls BIGINT,
  followups_sent BIGINT,
  followups_opened BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.disposition,
    count(*),
    count(*) FILTER (WHERE f.sent_at IS NOT NULL),
    count(*) FILTER (WHERE f.opened_at IS NOT NULL)
  FROM contact_call_logs l
  LEFT JOIN outreach_followups f
    ON f.call_log_id = l.id AND f.account_id = l.account_id
  WHERE l.account_id = p_account_id
    AND l.called_at >= p_start
    AND l.disposition IS NOT NULL
    AND is_account_member(p_account_id)
  GROUP BY l.disposition
  ORDER BY count(*) DESC;
$$;

COMMENT ON FUNCTION public.call_analytics_dispositions(UUID, TIMESTAMPTZ) IS
  'What connected calls actually produced, with the follow-up each disposition earned: sent counts opener/free-form sends, opened counts opener taps.';

CREATE OR REPLACE FUNCTION public.call_followup_funnel(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  total BIGINT,
  sent BIGINT,
  opened BIGINT,
  completed BIGINT,
  skipped BIGINT,
  failed BIGINT,
  scheduled BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE f.sent_at IS NOT NULL),
    count(*) FILTER (WHERE f.opened_at IS NOT NULL),
    count(*) FILTER (WHERE f.status = 'completed'),
    count(*) FILTER (WHERE f.status = 'skipped'),
    count(*) FILTER (WHERE f.status = 'failed'),
    count(*) FILTER (WHERE f.status = 'pending' AND f.scheduled_for IS NOT NULL)
  FROM outreach_followups f
  WHERE f.account_id = p_account_id
    AND f.created_at >= p_start
    AND is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.call_followup_funnel(UUID, TIMESTAMPTZ) IS
  'The post-call follow-up funnel: rows created, sends, opener taps, completions — and the skipped/failed rows that must stay visible rather than absent.';

CREATE OR REPLACE FUNCTION public.call_followup_skips(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (skip_reason TEXT, followups BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.skip_reason, count(*)
  FROM outreach_followups f
  WHERE f.account_id = p_account_id
    AND f.created_at >= p_start
    AND f.status = 'skipped'
    AND f.skip_reason IS NOT NULL
    AND is_account_member(p_account_id)
  GROUP BY f.skip_reason
  ORDER BY count(*) DESC;
$$;

COMMENT ON FUNCTION public.call_followup_skips(UUID, TIMESTAMPTZ) IS
  'Why follow-ups were not sent — a follow-up blocked by a Marketing-capped template or an opt-out should be visible, not absent.';

-- PostgREST exposes public functions at /rest/v1/rpc/ and Supabase
-- grants EXECUTE to anon/authenticated as roles — anon must be named
-- explicitly or the browser anon key can call these with any account
-- id (migrations 263/265, same trap).
REVOKE ALL ON FUNCTION public.call_analytics_summary(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.call_analytics_series(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.call_analytics_dispositions(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.call_followup_funnel(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.call_followup_skips(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_analytics_summary(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_series(UUID, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_dispositions(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_followup_funnel(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_followup_skips(UUID, TIMESTAMPTZ) TO authenticated;
