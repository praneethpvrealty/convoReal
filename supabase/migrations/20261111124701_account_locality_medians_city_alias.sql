-- account_locality_medians now folds a city's older or alternate name
-- into the one the market stats engine writes (canonicalCity in
-- src/lib/market/city.ts), so "Bangalore" and "Bengaluru" listings are
-- one city on both sides of the Market view. The alias list below must
-- stay equal to CITY_ALIASES; src/lib/market/city.test.ts compares them.
--
-- This replaces a function that already exists, so it is applied only
-- after the change is merged into main.

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
  WITH raw AS (
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
  ),
  normalized AS (
    SELECT
      CASE r.city
        WHEN 'bangalore' THEN 'bengaluru'
        WHEN 'bengalooru' THEN 'bengaluru'
        WHEN 'blr' THEN 'bengaluru'
        WHEN 'bangalore urban' THEN 'bengaluru'
        WHEN 'bengaluru urban' THEN 'bengaluru'
        WHEN 'mysore' THEN 'mysuru'
        WHEN 'mangalore' THEN 'mangaluru'
        WHEN 'belgaum' THEN 'belagavi'
        WHEN 'hubli' THEN 'hubballi'
        WHEN 'tumkur' THEN 'tumakuru'
        WHEN 'shimoga' THEN 'shivamogga'
        WHEN 'gulbarga' THEN 'kalaburagi'
        WHEN 'bellary' THEN 'ballari'
        WHEN 'bijapur' THEN 'vijayapura'
        WHEN 'gurgaon' THEN 'gurugram'
        WHEN 'bombay' THEN 'mumbai'
        WHEN 'madras' THEN 'chennai'
        WHEN 'calcutta' THEN 'kolkata'
        WHEN 'pondicherry' THEN 'puducherry'
        ELSE r.city
      END AS city,
      r.locality,
      r.property_type,
      r.listing_type,
      r.price,
      r.area_sqft
    FROM raw r
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
