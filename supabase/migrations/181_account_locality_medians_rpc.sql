-- ============================================================
-- 181_account_locality_medians_rpc.sql
-- The account's own side of the Market view: per-locality medians
-- for its active listings, so the UI can put "you" next to the
-- anonymized market_stats cells (migration 111).
--
-- Dimensions are normalized exactly like the stats engine
-- (normalizeToken in src/lib/market/stats-engine.ts): lowercased,
-- whitespace-collapsed, locality_canonical falling back to
-- sublocality — so a row here joins its market cell by string
-- equality on (city, locality, property_type, listing_type).
--
-- Own-data only: takes the account explicitly, guarded by
-- is_account_member. Reads of the cross-tenant market_stats table
-- stay in the consent-gated /api/market/stats route.
-- ============================================================

CREATE OR REPLACE FUNCTION public.account_locality_medians(p_account_id UUID)
RETURNS TABLE (
  city TEXT,
  locality TEXT,
  property_type TEXT,
  listing_type TEXT,
  listings_count BIGINT,
  median_price NUMERIC,
  median_area_sqft NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT
      NULLIF(lower(regexp_replace(trim(p.city), '\s+', ' ', 'g')), '') AS city,
      COALESCE(
        NULLIF(lower(regexp_replace(trim(p.locality_canonical), '\s+', ' ', 'g')), ''),
        NULLIF(lower(regexp_replace(trim(p.sublocality), '\s+', ' ', 'g')), '')
      ) AS locality,
      NULLIF(lower(regexp_replace(trim(p.type), '\s+', ' ', 'g')), '') AS property_type,
      COALESCE(
        NULLIF(lower(regexp_replace(trim(p.listing_type), '\s+', ' ', 'g')), ''),
        'sale'
      ) AS listing_type,
      p.price,
      p.area_sqft
    FROM properties p
    WHERE p.account_id = p_account_id
      AND p.status = 'Available'
      AND is_account_member(p_account_id)
  )
  SELECT
    n.city,
    n.locality,
    n.property_type,
    n.listing_type,
    count(*) AS listings_count,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY n.price)
      FILTER (WHERE n.price > 0) AS median_price,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY n.area_sqft)
      FILTER (WHERE n.area_sqft > 0) AS median_area_sqft
  FROM normalized n
  WHERE n.city IS NOT NULL
    AND n.locality IS NOT NULL
    AND n.property_type IS NOT NULL
  GROUP BY n.city, n.locality, n.property_type, n.listing_type;
$$;

COMMENT ON FUNCTION public.account_locality_medians(UUID) IS
  'Per (city, locality, property_type, listing_type) count and price/area medians of one account''s Available listings, normalized to match market_stats cell dimensions. Membership-guarded.';

REVOKE ALL ON FUNCTION public.account_locality_medians(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_locality_medians(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.account_locality_medians(UUID) TO authenticated;
