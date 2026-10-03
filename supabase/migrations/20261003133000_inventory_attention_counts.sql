-- ============================================================
-- 20261003133000_inventory_attention_counts.sql
--
-- The inventory summary tiles counted listings but never pointed at
-- the ones that need work. A listing that is Available yet has no
-- photos, no sale or rent price, or no map pin is invisible or
-- unconvincing on the showcase and drops out of map and near-me
-- search. Count those per listing party so the Needs attention tile
-- and the party pills under it agree with the list the tile filters.
-- The /api/properties needs_attention filter applies the same
-- predicate.
-- ============================================================

CREATE OR REPLACE FUNCTION public.inventory_attention_counts(p_account_id UUID)
RETURNS TABLE (
  agent_referred BOOLEAN,
  listings BIGINT,
  no_photos BIGINT,
  no_price BIGINT,
  no_pin BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH flagged AS (
    SELECT
      p.listing_source = 'agent' AS agent_referred,
      COALESCE(cardinality(p.images), 0) = 0 AS no_photos,
      COALESCE(p.price, 0) = 0 AND COALESCE(p.rent_per_month, 0) = 0 AS no_price,
      p.latitude IS NULL AS no_pin
    FROM properties p
    WHERE p.account_id = p_account_id
      AND p.status = 'Available'
      AND is_account_member(p_account_id)
  )
  SELECT
    f.agent_referred,
    count(*) FILTER (WHERE f.no_photos OR f.no_price OR f.no_pin),
    count(*) FILTER (WHERE f.no_photos),
    count(*) FILTER (WHERE f.no_price),
    count(*) FILTER (WHERE f.no_pin)
  FROM flagged f
  GROUP BY f.agent_referred;
$$;

COMMENT ON FUNCTION public.inventory_attention_counts(UUID) IS
  'Available listings missing photos, a price or a map pin, per listing party, for the inventory Needs attention tile.';

REVOKE ALL ON FUNCTION public.inventory_attention_counts(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_attention_counts(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_attention_counts(UUID) TO authenticated;
