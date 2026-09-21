-- ============================================================
-- 20260921183000_inventory_stats_published_active.sql
--
-- The Showcased Publicly tile counted every is_published row, archived
-- ones included, while clicking it lists only active listings — so an
-- account with an archived listing still flagged published saw a count
-- the list did not match. Count active published listings, the rows
-- the tile actually shows. Return type is unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.inventory_stats(p_account_id UUID)
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
    count(*) FILTER (WHERE p.is_published AND p.status <> 'Archived'),
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
