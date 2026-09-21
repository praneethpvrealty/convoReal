-- ============================================================
-- 20260921180000_inventory_import_counts.sql
--
-- How many other agencies hold a copy of each listing. The inventory
-- card showed an "Added to inventories" link on every listing whether
-- or not anyone had imported it, so the label read as a status rather
-- than a count. One SECURITY DEFINER rollup for the account replaces a
-- per-card count (AGENTS.md §2.6); only listings with at least one
-- copy come back, so an account nobody imports from pays nothing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.inventory_import_counts(target_account_id UUID)
RETURNS TABLE (
  property_id UUID,
  import_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS property_id,
    COUNT(c.id)::INTEGER AS import_count
  FROM properties p
  JOIN properties c
    ON c.source_property_id = p.id
   AND c.account_id <> p.account_id
  WHERE p.account_id = target_account_id
    AND is_account_member(target_account_id)
  GROUP BY p.id
$$;

COMMENT ON FUNCTION public.inventory_import_counts(UUID) IS
  'Per-listing count of copies held by other accounts; membership-guarded.';

REVOKE ALL ON FUNCTION public.inventory_import_counts(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_import_counts(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_import_counts(UUID) TO authenticated;
