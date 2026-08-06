-- ============================================================
-- 208_inventory_stats_listing_party.sql
-- Add listing-party counters to inventory_stats so the inventory
-- page's All / Direct / Agent referred pills can show result
-- counts without their own COUNT round trips.
--
-- The three new counters mirror the pill filters exactly: the
-- pills act on the All Listings tab, which excludes Archived
-- (GET /api/properties, exclude_archived), and filter with
-- listing_source = 'owner' / 'agent' verbatim.
--
-- Return type changes, so the function is dropped first —
-- CREATE OR REPLACE cannot change OUT parameters.
-- ============================================================

DROP FUNCTION IF EXISTS public.inventory_stats(UUID);

CREATE FUNCTION public.inventory_stats(p_account_id UUID)
RETURNS TABLE (
  total BIGINT,
  published BIGINT,
  available BIGINT,
  sold_or_contract BIGINT,
  pending_review BIGINT,
  active_total BIGINT,
  direct BIGINT,
  agent_referred BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE p.is_published),
    count(*) FILTER (WHERE p.status = 'Available'),
    count(*) FILTER (WHERE p.status IN ('Sold', 'Under Contract')),
    count(*) FILTER (WHERE p.status = 'Pending Review'),
    count(*) FILTER (WHERE p.status <> 'Archived'),
    count(*) FILTER (WHERE p.status <> 'Archived' AND p.listing_source = 'owner'),
    count(*) FILTER (WHERE p.status <> 'Archived' AND p.listing_source = 'agent')
  FROM properties p
  WHERE p.account_id = p_account_id
    AND is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.inventory_stats(UUID) IS
  'Inventory summary counters for one account in a single scan: the stat cards plus the listing-party pill counts.';

REVOKE ALL ON FUNCTION public.inventory_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_stats(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_stats(UUID) TO authenticated;
