-- Every viewed showcase listing with its last view time, in the order the
-- agent picks: most or fewest views, latest or earliest last view. Sorting
-- happens here so the order holds past the row bound, not only within it.
CREATE OR REPLACE FUNCTION public.pulse_viewed_properties(
  p_account_id UUID,
  p_sort TEXT DEFAULT 'views_desc',
  p_limit INT DEFAULT 500
)
RETURNS TABLE (
  property_id UUID,
  title TEXT,
  property_code TEXT,
  price NUMERIC,
  views_count BIGINT,
  unique_views_count BIGINT,
  last_viewed_at TIMESTAMPTZ
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
    count(DISTINCT e.session_key),
    max(e.created_at)
  FROM showcase_events e
  JOIN properties p
    ON p.id = e.property_id
   AND p.account_id = p_account_id
  WHERE e.account_id = p_account_id
    AND e.event_type = 'view_property'
    AND is_account_member(p_account_id)
  GROUP BY p.id, p.title, p.property_code, p.price
  ORDER BY
    CASE WHEN p_sort = 'views_asc' THEN count(*) END ASC,
    CASE WHEN p_sort = 'recent_desc' THEN max(e.created_at) END DESC,
    CASE WHEN p_sort = 'recent_asc' THEN max(e.created_at) END ASC,
    count(*) DESC,
    max(e.created_at) DESC,
    p.id
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

COMMENT ON FUNCTION public.pulse_viewed_properties(UUID, TEXT, INT) IS
  'Viewed showcase listings with view, unique-session and last-view columns, sorted by views or last view in either direction.';

REVOKE ALL ON FUNCTION public.pulse_viewed_properties(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pulse_viewed_properties(UUID, TEXT, INT) TO authenticated;
