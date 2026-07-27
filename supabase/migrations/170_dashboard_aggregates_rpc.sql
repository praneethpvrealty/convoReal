-- ============================================================
-- 170_dashboard_aggregates_rpc.sql
-- Stop shipping raw message and deal rows to the browser so the
-- dashboard can aggregate them in JavaScript.
--
-- Three loaders in src/lib/dashboard/queries.ts each pulled an
-- unbounded row set over the wire:
--
--   loadConversationsSeries — every message in the selected range
--     (7/30/90 days), to count them per day.
--   loadResponseTime — every message in the last 14 days, to pair
--     each first-inbound with the first outbound that followed it.
--   loadPipelineDonut — every open deal, to group by stage and sum.
--
-- None of them had a LIMIT, so the payload grew linearly with account
-- activity. Postgres can do all three in the database and return tens
-- of rows instead of tens of thousands.
--
-- Note on time zones: the chart buckets by the VIEWER's local day
-- (localDayKey uses getFullYear/getMonth/getDate), so the series
-- function takes an IANA zone and truncates in it. Bucketing in UTC
-- would silently shift every bar for anyone outside UTC.
-- ============================================================

-- Incoming/outgoing message counts per local day.
CREATE OR REPLACE FUNCTION public.dashboard_conversations_series(
  p_account_id UUID,
  p_start TIMESTAMPTZ,
  p_time_zone TEXT
)
RETURNS TABLE (
  day DATE,
  incoming BIGINT,
  outgoing BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (m.created_at AT TIME ZONE p_time_zone)::date AS day,
    count(*) FILTER (WHERE m.sender_type = 'customer'),
    -- agent + bot both count as outgoing, matching the JS
    count(*) FILTER (WHERE m.sender_type <> 'customer')
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.account_id = p_account_id
    AND c.is_archived = false
    AND m.created_at >= p_start
    AND is_account_member(p_account_id)
  GROUP BY 1
  ORDER BY 1;
$$;

COMMENT ON FUNCTION public.dashboard_conversations_series(UUID, TIMESTAMPTZ, TEXT) IS
  'Per-local-day incoming/outgoing message counts. Replaces fetching every message in the range to bucket client-side.';

-- Open deals per pipeline stage: count and brokerage total, using the
-- same COALESCE(brokerage_amount, value * 0.02) fallback the JS used.
-- Empty stages are dropped here rather than filtered afterwards.
CREATE OR REPLACE FUNCTION public.dashboard_pipeline_donut(p_account_id UUID)
RETURNS TABLE (
  stage_id UUID,
  stage_name TEXT,
  stage_color TEXT,
  deal_count BIGINT,
  total_value NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    COALESCE(NULLIF(s.color, ''), '#64748b'),
    count(d.id),
    COALESCE(SUM(COALESCE(d.brokerage_amount, COALESCE(d.value, 0) * 0.02)), 0)
  FROM pipeline_stages s
  JOIN deals d
    ON d.stage_id = s.id
   AND d.status = 'open'
   AND d.account_id = p_account_id
  WHERE s.account_id = p_account_id
    AND is_account_member(p_account_id)
  GROUP BY s.id, s.name, s.color, s.position
  HAVING count(d.id) > 0
  ORDER BY s.position;
$$;

COMMENT ON FUNCTION public.dashboard_pipeline_donut(UUID) IS
  'Open-deal count and brokerage total per pipeline stage. Replaces fetching every open deal to group client-side.';

-- First-inbound → first-following-outbound pairs, one per unreplied
-- customer run, mirroring the walk the JS used to do over every
-- message. `out_seq` counts outbound messages up to and including each
-- row, so all customer messages waiting on the same reply share a
-- block, and the outbound that answers them is the sole member of the
-- next block. Returning pairs rather than raw messages keeps the
-- caller's day-of-week and this-week/last-week bucketing untouched —
-- that still has to happen in the viewer's local time.
CREATE OR REPLACE FUNCTION public.dashboard_response_samples(
  p_account_id UUID,
  p_start TIMESTAMPTZ
)
RETURNS TABLE (
  customer_at TIMESTAMPTZ,
  response_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ordered AS (
    SELECT
      m.conversation_id,
      m.sender_type,
      m.created_at,
      SUM(CASE WHEN m.sender_type <> 'customer' THEN 1 ELSE 0 END) OVER (
        PARTITION BY m.conversation_id
        ORDER BY m.created_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS out_seq
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.account_id = p_account_id
      AND c.is_archived = false
      AND m.created_at >= p_start
      AND is_account_member(p_account_id)
  ),
  waiting AS (
    SELECT conversation_id, out_seq AS blk, MIN(created_at) AS customer_at
    FROM ordered
    WHERE sender_type = 'customer'
    GROUP BY conversation_id, out_seq
  ),
  replies AS (
    SELECT conversation_id, out_seq AS blk, MIN(created_at) AS response_at
    FROM ordered
    WHERE sender_type <> 'customer'
    GROUP BY conversation_id, out_seq
  )
  SELECT w.customer_at, r.response_at
  FROM waiting w
  JOIN replies r
    ON r.conversation_id = w.conversation_id
   AND r.blk = w.blk + 1
  WHERE r.response_at >= w.customer_at;
$$;

COMMENT ON FUNCTION public.dashboard_response_samples(UUID, TIMESTAMPTZ) IS
  'Paired first-inbound/first-reply timestamps for response-time stats. Replaces fetching 14 days of messages to pair client-side.';

REVOKE ALL ON FUNCTION public.dashboard_conversations_series(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_pipeline_donut(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_response_samples(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_conversations_series(UUID, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_pipeline_donut(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_response_samples(UUID, TIMESTAMPTZ) TO authenticated;
