-- ============================================================
-- 168_inventory_stats_rpc.sql
-- Collapse the inventory summary panel's five COUNT queries into
-- one pass over the account's properties.
--
-- The panel (inventory-content.tsx) issued five PostgREST
-- `count: 'exact'` HEAD requests in parallel — total, published,
-- available, sold/under-contract, pending-review. A comment there
-- claimed they were "cheap regardless of the total number of rows";
-- that is not how `count=exact` behaves. PostgREST issues a real
-- COUNT(*) over the filtered set, so each request scans every row
-- the account owns. Five of them scan the account's inventory five
-- times on every visit to the page.
--
-- FILTER aggregates give the same five numbers from a single scan.
-- ============================================================

-- Covering index so the scan above is index-only: account_id does the
-- seek, status and is_published are read from the index rather than
-- the heap. Replaces nothing — properties(account_id) stays for the
-- plain lookups.
CREATE INDEX IF NOT EXISTS idx_properties_account_stats
  ON properties(account_id) INCLUDE (status, is_published);

-- SECURITY DEFINER so the aggregate runs without per-row RLS
-- evaluation, with the membership check done once up front. A
-- non-member gets zeros rather than another account's totals: the
-- guard sits in the WHERE clause, and `is_account_member` is STABLE,
-- so Postgres evaluates it a single time and returns no rows when it
-- is false.
CREATE OR REPLACE FUNCTION public.inventory_stats(p_account_id UUID)
RETURNS TABLE (
  total BIGINT,
  published BIGINT,
  available BIGINT,
  sold_or_contract BIGINT,
  pending_review BIGINT
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
    count(*) FILTER (WHERE p.status = 'Pending Review')
  FROM properties p
  WHERE p.account_id = p_account_id
    AND is_account_member(p_account_id);
$$;

COMMENT ON FUNCTION public.inventory_stats(UUID) IS
  'Inventory summary counters for one account in a single scan. Replaces five count=exact round trips from the inventory page.';

REVOKE ALL ON FUNCTION public.inventory_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_stats(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_stats(UUID) TO authenticated;
