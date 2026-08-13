-- ============================================================
-- 265_account_property_tags.sql
--
-- The tags an account already uses, most-used first.
--
-- properties.tags (migration 192) is free text, and free text spread
-- across a project's listings is how a search stops working: "APM" on
-- three villas and "AMP" on the fourth means the fourth is invisible to
-- the search the tag exists for. Offering what is already in use turns
-- the common case into a tap and leaves typing for genuinely new tags.
--
-- Aggregated here rather than in the client (AGENTS.md §2.6) — the
-- alternative is fetching every listing's tag array to count them in the
-- browser, which grows with inventory instead of with the answer.
-- ============================================================

CREATE OR REPLACE FUNCTION account_property_tags(target_account_id UUID)
RETURNS TABLE (tag TEXT, uses BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.tag, COUNT(*) AS uses
  FROM properties p
  CROSS JOIN LATERAL unnest(p.tags) AS t(tag)
  WHERE p.account_id = target_account_id
    AND is_account_member(target_account_id)
    AND t.tag <> ''
  GROUP BY t.tag
  ORDER BY uses DESC, t.tag ASC
  LIMIT 200;
$$;

COMMENT ON FUNCTION account_property_tags(UUID) IS
  'Distinct property tags in use for an account with their counts, most-used first. SECURITY DEFINER, guarded by is_account_member.';

-- PostgREST exposes every public function at /rest/v1/rpc/, and Supabase
-- grants EXECUTE to anon and authenticated as ROLES rather than through
-- PUBLIC — so anon has to be named, or the anon key that ships in the
-- browser bundle can call this with any account id (migration 263, and
-- the same trap as 264).
REVOKE EXECUTE ON FUNCTION account_property_tags(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION account_property_tags(UUID) TO authenticated, service_role;
