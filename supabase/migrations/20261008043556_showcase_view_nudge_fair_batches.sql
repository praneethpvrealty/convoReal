-- ============================================================
-- 20261008043556_showcase_view_nudge_fair_batches.sql
-- showcase_view_nudge_candidates returned its batch in account and
-- contact order, so one account whose check-ins wait on template
-- approval (claims released every sweep) could fill every batch and
-- starve the rest. The batch is now drawn at random from all
-- qualifying contacts.
-- ============================================================

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
VOLATILE
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
  SELECT d.account_id, d.contact_id, d.property_id, d.dwell_ms, d.viewed_at
  FROM (
    SELECT DISTINCT ON (q.account_id, q.contact_id)
      q.account_id, q.contact_id, q.property_id, q.dwell_ms, q.viewed_at
    FROM qualifying q
    ORDER BY q.account_id, q.contact_id, q.dwell_ms DESC, q.viewed_at DESC
  ) d
  ORDER BY random()
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.showcase_view_nudge_candidates(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_view_nudge_candidates(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER)
  TO service_role;

