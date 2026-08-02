-- ============================================================
-- 172_pulse_stats_rpc.sql
-- Showcase Pulse aggregates, computed in Postgres.
--
-- src/lib/pulse/queries.ts pulls every showcase_events row for the
-- account (session_key + event_type + metadata) just to count opens,
-- distinct sessions and average dwell, then pulls every
-- 'view_property' row again to rank listings. Neither query has a
-- LIMIT, so both payloads grow linearly with showcase traffic. That is
-- already wasteful on a desktop browser; the mobile app reads the same
-- numbers over a phone connection.
--
-- These functions return three rows, five rows and one row per
-- identified viewer respectively.
-- ============================================================

-- Headline tiles: link opens, unique devices, average property dwell.
-- Only 'open' counts as a view (the tile promises "every link open
-- counts as one"), while unique sessions span every beacon type.
CREATE OR REPLACE FUNCTION public.pulse_stats(p_account_id UUID)
RETURNS TABLE (
  total_views BIGINT,
  unique_sessions BIGINT,
  avg_dwell_sec INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE e.event_type = 'open'),
    count(DISTINCT e.session_key),
    COALESCE(
      round(
        avg((e.metadata->>'duration_ms')::numeric) FILTER (
          WHERE e.event_type = 'view_property'
            AND jsonb_typeof(e.metadata->'duration_ms') = 'number'
        ) / 1000
      )::int,
      0
    )
  FROM showcase_events e
  WHERE e.account_id = p_account_id
    AND is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.pulse_stats(UUID) IS
  'Showcase Pulse headline tiles: link opens, unique sessions, average dwell seconds.';

-- Most-viewed listings. Only real 'view_property' events count —
-- including map clicks and gallery swipes would inflate the ranking.
-- The listing columns come back with the counts so the caller does not
-- follow up with a second properties query.
CREATE OR REPLACE FUNCTION public.pulse_top_properties(
  p_account_id UUID,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  property_id UUID,
  title TEXT,
  property_code TEXT,
  price NUMERIC,
  views_count BIGINT,
  unique_views_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.title,
    p.property_code,
    p.price,
    count(*),
    count(DISTINCT e.session_key)
  FROM showcase_events e
  JOIN properties p
    ON p.id = e.property_id
   AND p.account_id = p_account_id
  WHERE e.account_id = p_account_id
    AND e.event_type = 'view_property'
    AND is_account_member(p_account_id)
  GROUP BY p.id, p.title, p.property_code, p.price
  ORDER BY count(*) DESC
  LIMIT GREATEST(p_limit, 1);
$$;

COMMENT ON FUNCTION public.pulse_top_properties(UUID, INT) IS
  'Top showcase listings by property view count, with unique-session counts and listing columns.';

-- Identified viewers of one listing. Anonymous and forwarded views
-- carry no contact_id and are excluded by the join.
CREATE OR REPLACE FUNCTION public.pulse_property_viewers(
  p_account_id UUID,
  p_property_id UUID
)
RETURNS TABLE (
  contact_id UUID,
  name TEXT,
  phone TEXT,
  views_count BIGINT,
  sessions_count BIGINT,
  last_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.phone,
    count(*) FILTER (WHERE e.event_type = 'view_property'),
    count(DISTINCT e.session_key),
    max(e.created_at)
  FROM showcase_events e
  JOIN contacts c
    ON c.id = e.contact_id
   AND c.account_id = p_account_id
  WHERE e.account_id = p_account_id
    AND e.property_id = p_property_id
    AND is_account_member(p_account_id)
  GROUP BY c.id, c.name, c.phone
  ORDER BY max(e.created_at) DESC;
$$;

COMMENT ON FUNCTION public.pulse_property_viewers(UUID, UUID) IS
  'Identified viewers of one showcase listing: view count, session count, last seen.';

REVOKE ALL ON FUNCTION public.pulse_stats(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pulse_top_properties(UUID, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pulse_property_viewers(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pulse_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pulse_top_properties(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pulse_property_viewers(UUID, UUID) TO authenticated;
