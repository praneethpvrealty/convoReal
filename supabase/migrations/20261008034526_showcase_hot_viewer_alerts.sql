-- ============================================================
-- 20261008034526_showcase_hot_viewer_alerts.sql
-- Tells the agent when an identified showcase visitor is hot on one
-- listing: a long total dwell, or coming back to it on separate days.
-- One row per contact x property; a listing re-alerts only after the
-- re-alert gap, and a contact raises at most one alert a day.
-- ============================================================

CREATE TABLE IF NOT EXISTS showcase_hot_viewer_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  dwell_ms INTEGER NOT NULL,
  view_days INTEGER NOT NULL,
  agent_user_id UUID,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, contact_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_showcase_hot_viewer_alerts_contact
  ON showcase_hot_viewer_alerts (account_id, contact_id, alerted_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at'
      AND tgrelid = 'public.showcase_hot_viewer_alerts'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at BEFORE UPDATE ON showcase_hot_viewer_alerts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE showcase_hot_viewer_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'showcase_hot_viewer_alerts'
      AND policyname = 'showcase_hot_viewer_alerts_select'
  ) THEN
    CREATE POLICY showcase_hot_viewer_alerts_select ON showcase_hot_viewer_alerts
      FOR SELECT USING (is_account_member(account_id));
  END IF;
END $$;

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
STABLE
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
              THEN (e.metadata->>'duration_ms')::BIGINT
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
  SELECT DISTINCT ON (q.account_id, q.contact_id)
    q.account_id, q.contact_id, q.property_id, q.dwell_ms, q.view_days, q.viewed_at
  FROM qualifying q
  ORDER BY q.account_id, q.contact_id, q.dwell_ms DESC, q.view_days DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.showcase_hot_viewer_candidates(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_hot_viewer_candidates(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_showcase_hot_viewer_alert(
  p_account_id UUID,
  p_contact_id UUID,
  p_property_id UUID,
  p_dwell_ms INTEGER,
  p_view_days INTEGER,
  p_realert_days INTEGER
)
RETURNS UUID
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  INSERT INTO showcase_hot_viewer_alerts AS a (
    account_id, contact_id, property_id, dwell_ms, view_days
  )
  VALUES (p_account_id, p_contact_id, p_property_id, p_dwell_ms, p_view_days)
  ON CONFLICT (account_id, contact_id, property_id) DO UPDATE
    SET alerted_at = NOW(),
        dwell_ms = EXCLUDED.dwell_ms,
        view_days = EXCLUDED.view_days,
        agent_user_id = NULL
    WHERE a.alerted_at <= NOW() - make_interval(days => p_realert_days)
  RETURNING a.id;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_showcase_hot_viewer_alert(UUID, UUID, UUID, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_showcase_hot_viewer_alert(UUID, UUID, UUID, INTEGER, INTEGER, INTEGER)
  TO service_role;
