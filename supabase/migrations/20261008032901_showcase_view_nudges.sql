-- ============================================================
-- 20261008032901_showcase_view_nudges.sql
-- A WhatsApp check-in for an identified showcase visitor who spent
-- real time on a listing: Book a visit / Call me back / Not for me.
-- One row per contact x property, so a listing is never asked about
-- twice; the sweep reads candidates through showcase_view_nudge_candidates
-- and claims each with claim_showcase_view_nudge.
-- ============================================================

CREATE TABLE IF NOT EXISTS showcase_view_nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  dwell_ms INTEGER NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  skip_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  message_id TEXT,
  channel TEXT CHECK (channel IN ('buttons', 'template')),
  response TEXT CHECK (response IN ('visit', 'callback', 'not_for_me')),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, contact_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_showcase_view_nudges_contact_sent
  ON showcase_view_nudges (account_id, contact_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_showcase_events_identified_views
  ON showcase_events (created_at)
  WHERE event_type = 'view_property'
    AND contact_id IS NOT NULL
    AND property_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON showcase_view_nudges;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON showcase_view_nudges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE showcase_view_nudges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'showcase_view_nudges'
      AND policyname = 'showcase_view_nudges_select'
  ) THEN
    CREATE POLICY showcase_view_nudges_select ON showcase_view_nudges
      FOR SELECT USING (is_account_member(account_id));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.showcase_view_nudge_candidates(
  p_min_dwell_ms INTEGER,
  p_settle_minutes INTEGER,
  p_lookback_hours INTEGER,
  p_cooldown_days INTEGER,
  p_limit INTEGER
)
RETURNS TABLE (
  account_id UUID,
  contact_id UUID,
  property_id UUID,
  dwell_ms INTEGER,
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
        SUM(GREATEST(COALESCE((e.metadata->>'duration_ms')::BIGINT, 0), 0)),
        2147483647
      )::INTEGER AS dwell_ms,
      MAX(e.created_at) AS viewed_at
    FROM showcase_events e
    WHERE e.event_type = 'view_property'
      AND e.contact_id IS NOT NULL
      AND e.property_id IS NOT NULL
      AND e.created_at >= NOW() - make_interval(hours => p_lookback_hours)
      AND (e.metadata->>'duration_ms') ~ '^[0-9]{1,9}$'
    GROUP BY e.account_id, e.contact_id, e.property_id
  ),
  qualifying AS (
    SELECT v.*
    FROM views v
    JOIN contacts c
      ON c.id = v.contact_id AND c.account_id = v.account_id
    JOIN properties p
      ON p.id = v.property_id AND p.account_id = v.account_id
    WHERE v.dwell_ms >= p_min_dwell_ms
      AND c.phone IS NOT NULL
      AND COALESCE(c.is_dead, false) = false
      AND COALESCE(c.is_archived, false) = false
      AND COALESCE(c.chain_only, false) = false
      AND COALESCE(c.buyer_alerts_consent, 'pending') <> 'declined'
      AND COALESCE(c.classification, '') NOT IN ('Agent', 'Developer')
      AND (c.pitch_quiet_until IS NULL OR c.pitch_quiet_until <= NOW())
      AND p.status = 'Available'
      AND p.owner_contact_id IS DISTINCT FROM v.contact_id
      AND NOT EXISTS (
        SELECT 1 FROM showcase_events recent
        WHERE recent.account_id = v.account_id
          AND recent.contact_id = v.contact_id
          AND recent.created_at > NOW() - make_interval(mins => p_settle_minutes)
      )
      AND NOT EXISTS (
        SELECT 1 FROM showcase_view_nudges n
        WHERE n.account_id = v.account_id
          AND n.contact_id = v.contact_id
          AND n.property_id = v.property_id
          AND NOT (
            n.attempts < 3
            AND (
              n.status = 'failed'
              OR (n.status = 'pending' AND n.claimed_at < NOW() - INTERVAL '15 minutes')
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM showcase_view_nudges n
        WHERE n.account_id = v.account_id
          AND n.contact_id = v.contact_id
          AND n.property_id <> v.property_id
          AND (
            n.sent_at > NOW() - make_interval(days => p_cooldown_days)
            OR (n.status = 'pending' AND n.claimed_at >= NOW() - INTERVAL '15 minutes')
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM property_shares s
        WHERE s.account_id = v.account_id
          AND s.contact_id = v.contact_id
          AND s.property_id = v.property_id
          AND (
            s.feedback_sent_at > NOW() - make_interval(days => p_cooldown_days)
            OR (s.feedback_status = 'pending' AND s.created_at > NOW() - INTERVAL '2 hours')
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM conversations conv
        JOIN messages m
          ON m.conversation_id = conv.id AND m.account_id = conv.account_id
        WHERE conv.account_id = v.account_id
          AND conv.contact_id = v.contact_id
          AND m.created_at >= v.viewed_at
          AND m.sender_type IN ('customer', 'agent')
          AND m.deleted_at IS NULL
      )
  )
  SELECT DISTINCT ON (q.account_id, q.contact_id)
    q.account_id, q.contact_id, q.property_id, q.dwell_ms, q.viewed_at
  FROM qualifying q
  ORDER BY q.account_id, q.contact_id, q.dwell_ms DESC, q.viewed_at DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.showcase_view_nudge_candidates(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_view_nudge_candidates(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_showcase_view_nudge(
  p_account_id UUID,
  p_contact_id UUID,
  p_property_id UUID,
  p_dwell_ms INTEGER,
  p_viewed_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  INSERT INTO showcase_view_nudges AS n (
    account_id, contact_id, property_id, dwell_ms, viewed_at
  )
  VALUES (p_account_id, p_contact_id, p_property_id, p_dwell_ms, p_viewed_at)
  ON CONFLICT (account_id, contact_id, property_id) DO UPDATE
    SET status = 'pending',
        attempts = n.attempts + 1,
        claimed_at = NOW(),
        skip_reason = NULL,
        dwell_ms = EXCLUDED.dwell_ms,
        viewed_at = EXCLUDED.viewed_at
    WHERE n.attempts < 3
      AND (
        n.status = 'failed'
        OR (n.status = 'pending' AND n.claimed_at < NOW() - INTERVAL '15 minutes')
      )
  RETURNING n.id;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_showcase_view_nudge(UUID, UUID, UUID, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_showcase_view_nudge(UUID, UUID, UUID, INTEGER, TIMESTAMPTZ)
  TO service_role;
