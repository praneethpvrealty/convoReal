-- ============================================================
-- 20261008063957_showcase_hot_viewer_dwell_cap.sql
-- The public showcase beacon accepts any duration_ms a browser sends,
-- and the 30-minute cap is applied only in the page. A hot-viewer alert
-- now counts each view for at most 30 minutes, so one forged event
-- cannot raise it. The batch is drawn at random from all qualifying
-- contacts, so one busy account cannot starve the rest past the
-- 24-hour freshness window.
-- ============================================================

CREATE OR REPLACE FUNCTION public.showcase_hot_viewer_candidates(
  p_min_dwell_ms INTEGER,
  p_min_days INTEGER,
  p_settle_minutes INTEGER,
  p_fresh_hours INTEGER,
  p_lookback_days INTEGER,
  p_realert_days INTEGER,
  p_limit INTEGER
)
RETURNS TABLE (
  account_id UUID,
  contact_id UUID,
  property_id UUID,
  dwell_ms INTEGER,
  view_days INTEGER,
  viewed_at TIMESTAMPTZ
)
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  WITH views AS (
    SELECT
      e.account_id,
      e.contact_id,
      e.property_id,
      LEAST(
        SUM(
          CASE
            WHEN (e.metadata->>'duration_ms') ~ '^[0-9]{1,9}$'
              THEN LEAST((e.metadata->>'duration_ms')::BIGINT, 1800000)
            ELSE 0
          END
        ),
        2147483647
      )::INTEGER AS dwell_ms,
      COUNT(DISTINCT (e.created_at AT TIME ZONE 'Asia/Kolkata')::DATE)::INTEGER AS view_days,
      MAX(e.created_at) AS viewed_at
    FROM showcase_events e
    WHERE e.event_type = 'view_property'
      AND e.contact_id IS NOT NULL
      AND e.property_id IS NOT NULL
      AND e.created_at >= NOW() - make_interval(days => p_lookback_days)
    GROUP BY e.account_id, e.contact_id, e.property_id
  ),
  qualifying AS (
    SELECT v.*
    FROM views v
    JOIN contacts c
      ON c.id = v.contact_id AND c.account_id = v.account_id
    JOIN properties p
      ON p.id = v.property_id AND p.account_id = v.account_id
    WHERE (v.dwell_ms >= p_min_dwell_ms OR v.view_days >= p_min_days)
      AND v.viewed_at >= NOW() - make_interval(hours => p_fresh_hours)
      AND COALESCE(c.is_dead, false) = false
      AND COALESCE(c.is_archived, false) = false
      AND COALESCE(c.chain_only, false) = false
      AND COALESCE(c.classification, '') NOT IN ('Agent', 'Developer')
      AND p.status = 'Available'
      AND p.owner_contact_id IS DISTINCT FROM v.contact_id
      AND NOT EXISTS (
        SELECT 1 FROM showcase_events recent
        WHERE recent.account_id = v.account_id
          AND recent.contact_id = v.contact_id
          AND recent.created_at > NOW() - make_interval(mins => p_settle_minutes)
      )
      AND NOT EXISTS (
        SELECT 1 FROM showcase_hot_viewer_alerts a
        WHERE a.account_id = v.account_id
          AND a.contact_id = v.contact_id
          AND (
            (a.property_id = v.property_id
              AND a.alerted_at > NOW() - make_interval(days => p_realert_days))
            OR (a.property_id <> v.property_id
              AND a.alerted_at > NOW() - INTERVAL '24 hours')
          )
      )
  )
  SELECT d.account_id, d.contact_id, d.property_id, d.dwell_ms, d.view_days, d.viewed_at
  FROM (
    SELECT DISTINCT ON (q.account_id, q.contact_id)
      q.account_id, q.contact_id, q.property_id, q.dwell_ms, q.view_days, q.viewed_at
    FROM qualifying q
    ORDER BY q.account_id, q.contact_id, q.dwell_ms DESC, q.view_days DESC
  ) d
  ORDER BY random()
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.showcase_hot_viewer_candidates(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_hot_viewer_candidates(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER)
  TO service_role;
