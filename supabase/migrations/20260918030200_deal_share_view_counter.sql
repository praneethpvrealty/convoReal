-- ============================================================
-- 20260918030200_deal_share_view_counter.sql — count link opens in
-- SQL. Two opens resolving the same link before either tracking
-- write landed both carried the same view_count and wrote the same
-- N + 1, losing one open while both access-log rows were inserted.
-- The increment now happens in the database, once per call.
--
-- Service-role only: the public deal-share routes are the only
-- callers, and nothing a browser session holds may bump a counter.
--
-- Purely additive (a new function). Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION bump_deal_share_view(p_link_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE deal_share_links
  SET view_count = view_count + 1,
      last_viewed_at = NOW()
  WHERE id = p_link_id;
$$;

REVOKE EXECUTE ON FUNCTION bump_deal_share_view(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bump_deal_share_view(UUID) TO service_role;
