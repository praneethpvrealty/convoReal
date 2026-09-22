-- ============================================================
-- 20260922031500_contact_area_group_counts.sql
--
-- contact_area_options counts contacts per stored spelling; the API
-- then merges spellings of one locality into a group. A contact that
-- carries two spellings of the same place ("Brookefield" in
-- areas_of_interest, "Brookfield" in pref_areas) would be counted
-- twice by summing those per-spelling counts. This second pass takes
-- the grouped spellings back and counts distinct contacts per group,
-- so the chip says how many contacts a pick will actually match.
-- Guarded by is_account_member(), like the first pass.
-- ============================================================

CREATE OR REPLACE FUNCTION public.contact_area_group_counts(
  p_account_id UUID,
  p_groups JSONB
)
RETURNS TABLE (key TEXT, n BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.key, COUNT(DISTINCT c.id)::BIGINT AS n
  FROM jsonb_to_recordset(p_groups) AS g(key TEXT, variants TEXT[])
  LEFT JOIN contacts c
    ON c.account_id = p_account_id
   AND COALESCE(c.is_merged, FALSE) = FALSE
   AND COALESCE(c.chain_only, FALSE) = FALSE
   AND (
     COALESCE(c.areas_of_interest, '{}'::TEXT[])
     || COALESCE(c.pref_areas, '{}'::TEXT[])
   ) && g.variants
  WHERE public.is_account_member(p_account_id)
  GROUP BY g.key;
$$;

REVOKE ALL ON FUNCTION public.contact_area_group_counts(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_area_group_counts(UUID, JSONB) TO authenticated;
