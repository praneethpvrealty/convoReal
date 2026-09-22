-- ============================================================
-- 20260922024134_contact_area_options.sql
--
-- The Contacts area filter needs every distinct locality stored on the
-- account's contacts. Both surfaces were selecting the two array
-- columns of every contact and de-duplicating in the browser — a
-- payload that grows with the account, which §2.6 of AGENTS.md forbids
-- (mobile capped it at 500 rows and so showed a partial list).
--
-- One unnest over both columns returns each spelling once with the
-- number of contacts that carry it. A contact naming the same spelling
-- in both columns counts once. Guarded by is_account_member(), like
-- every other SECURITY DEFINER aggregate here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.contact_area_options(
  p_account_id UUID
)
RETURNS TABLE (area TEXT, n BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.area, COUNT(*)::BIGINT AS n
  FROM (
    SELECT DISTINCT c.id, BTRIM(a.area) AS area
    FROM contacts c
    CROSS JOIN LATERAL UNNEST(
      COALESCE(c.areas_of_interest, '{}'::TEXT[])
      || COALESCE(c.pref_areas, '{}'::TEXT[])
    ) AS a(area)
    WHERE c.account_id = p_account_id
      AND public.is_account_member(p_account_id)
      AND COALESCE(c.is_merged, FALSE) = FALSE
      AND COALESCE(c.chain_only, FALSE) = FALSE
      AND NULLIF(BTRIM(a.area), '') IS NOT NULL
  ) x
  GROUP BY x.area
  ORDER BY n DESC, x.area;
$$;

REVOKE ALL ON FUNCTION public.contact_area_options(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_area_options(UUID) TO authenticated;
