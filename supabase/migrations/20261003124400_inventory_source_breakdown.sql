-- ============================================================
-- 20261003124400_inventory_source_breakdown.sql
--
-- The listing-party pills on the inventory page (All / Direct / Agent
-- referred) read inventory_stats, whose splits only cover non-archived
-- rows. On the Review and Archived tabs, and under a summary-tile
-- filter, the pills kept showing account-wide active counts that the
-- list below them could not match ("All (223)" over an empty Archived
-- tab). Direct also counted only listing_source = 'owner', so owner
-- self-listings made over WhatsApp fell into neither pill.
--
-- Return the account's listings grouped by the three things the list
-- filters on — status, showcase flag and agent-referred — so the page
-- can count exactly the rows each tab, tile and pill yields. The
-- groups are bounded by the status vocabulary, not by inventory size.
-- ============================================================

CREATE OR REPLACE FUNCTION public.inventory_source_breakdown(p_account_id UUID)
RETURNS TABLE (
  status TEXT,
  is_published BOOLEAN,
  agent_referred BOOLEAN,
  listings BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.status::TEXT,
    COALESCE(p.is_published, false),
    p.listing_source = 'agent',
    count(*)
  FROM properties p
  WHERE p.account_id = p_account_id
    AND is_account_member(p_account_id)
  GROUP BY 1, 2, 3;
$$;

COMMENT ON FUNCTION public.inventory_source_breakdown(UUID) IS
  'Listing counts for one account grouped by status, showcase flag and agent-referred, so the inventory tabs and listing-party pills count the rows they list.';

REVOKE ALL ON FUNCTION public.inventory_source_breakdown(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_source_breakdown(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_source_breakdown(UUID) TO authenticated;
