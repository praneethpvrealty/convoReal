-- Portal emails expose one generic area, while the inventory keeps
-- built-up, super-built-up and plot extents separately. Compare the
-- portal value with the nearest compatible Sq.Ft. measurement and keep
-- legacy email fallbacks scoped to the correct portal ad.

CREATE OR REPLACE FUNCTION portal_listing_drift(target_account_id UUID)
RETURNS TABLE (
  portal TEXT,
  portal_listing_id TEXT,
  listing_url TEXT,
  expires_on DATE,
  property_id UUID,
  property_title TEXT,
  property_code TEXT,
  property_status TEXT,
  drift_kind TEXT,
  lead_count BIGINT,
  last_lead_at TIMESTAMPTZ,
  parsed_property_type TEXT,
  parsed_price NUMERIC,
  parsed_area_sqft NUMERIC,
  listing_type TEXT,
  listing_price NUMERIC,
  listing_area_sqft NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mapped AS (
    SELECT
      ppl.id AS mapped_id,
      ppl.portal,
      ppl.portal_listing_id,
      ppl.listing_url,
      ppl.expires_on,
      p.id AS property_id,
      p.title AS property_title,
      p.property_code,
      p.status AS property_status,
      p.type AS listing_type,
      p.price AS listing_price,
      p.area_sqft AS listing_area_sqft,
      p.land_area AS listing_land_area,
      p.land_area_unit AS listing_land_area_unit,
      p.super_built_area AS listing_super_built_area,
      COUNT(*) OVER (PARTITION BY p.id) AS active_mapping_count
    FROM property_portal_listings ppl
    JOIN properties p ON p.id = ppl.property_id AND p.account_id = target_account_id
    WHERE ppl.account_id = target_account_id
      AND ppl.portal_listing_id IS NOT NULL
      AND ppl.status = 'active'
  ),
  lead_stats AS (
    SELECT
      m.mapped_id,
      COUNT(c.id) FILTER (WHERE c.created_at >= now() - INTERVAL '30 days') AS recent_leads,
      COUNT(c.id) FILTER (
        WHERE m.expires_on IS NOT NULL AND c.created_at::date > m.expires_on
      ) AS leads_after_expiry,
      MAX(c.created_at) AS last_lead_at
    FROM mapped m
    LEFT JOIN contacts c
      ON c.account_id = target_account_id
     AND c.lead_portal = m.portal
     AND c.lead_portal_listing_id = m.portal_listing_id
    GROUP BY m.mapped_id
  ),
  latest_parsed AS (
    SELECT DISTINCT ON (m.mapped_id)
      m.mapped_id,
      l.parsed_property_type,
      l.parsed_price,
      l.parsed_area_sqft
    FROM mapped m
    JOIN email_sync_logs l
      ON l.account_id = target_account_id
     AND (
       (l.lead_portal = m.portal AND l.lead_portal_listing_id = m.portal_listing_id)
       OR (
         l.lead_portal_listing_id IS NULL
         AND l.matched_property_id = m.property_id
         AND l.match_score >= 100
         AND (
           l.lead_portal = m.portal
           OR (l.lead_portal IS NULL AND m.active_mapping_count = 1)
         )
       )
     )
     AND (
       l.parsed_property_type IS NOT NULL
       OR l.parsed_price IS NOT NULL
       OR l.parsed_area_sqft IS NOT NULL
     )
    ORDER BY m.mapped_id, l.created_at DESC
  ),
  detail_comparison AS (
    SELECT
      m.*,
      s.recent_leads,
      s.last_lead_at,
      lp.parsed_property_type,
      lp.parsed_price,
      lp.parsed_area_sqft,
      closest_area.area_sqft AS comparable_listing_area,
      (
        lp.parsed_property_type IS NOT NULL
        AND m.listing_type IS NOT NULL
        AND POSITION(LOWER(m.listing_type) IN LOWER(lp.parsed_property_type)) = 0
        AND POSITION(LOWER(lp.parsed_property_type) IN LOWER(m.listing_type)) = 0
        AND NOT EXISTS (
          SELECT 1
          FROM regexp_split_to_table(LOWER(lp.parsed_property_type), '[^a-z0-9]+') AS w(word)
          WHERE LENGTH(w.word) > 2
            AND w.word IN (
              SELECT v.word
              FROM regexp_split_to_table(LOWER(m.listing_type), '[^a-z0-9]+') AS v(word)
            )
        )
      ) AS type_drift,
      (
        lp.parsed_price IS NOT NULL
        AND lp.parsed_price > 0
        AND m.listing_price IS NOT NULL
        AND m.listing_price > 0
        AND ABS(lp.parsed_price - m.listing_price) > m.listing_price * 0.10
      ) AS price_drift,
      (
        lp.parsed_area_sqft IS NOT NULL
        AND lp.parsed_area_sqft > 0
        AND closest_area.area_sqft IS NOT NULL
        AND ABS(lp.parsed_area_sqft - closest_area.area_sqft) > closest_area.area_sqft * 0.10
      ) AS area_drift
    FROM mapped m
    JOIN lead_stats s ON s.mapped_id = m.mapped_id
    JOIN latest_parsed lp ON lp.mapped_id = m.mapped_id
    LEFT JOIN LATERAL (
      SELECT candidate.area_sqft
      FROM (
        VALUES
          (m.listing_area_sqft),
          (m.listing_super_built_area),
          (
            CASE
              WHEN REGEXP_REPLACE(LOWER(COALESCE(m.listing_land_area_unit, '')), '[^a-z0-9]+', '', 'g')
                IN ('sqft', 'squarefeet', 'squarefoot')
              THEN m.listing_land_area
              ELSE NULL
            END
          )
      ) AS candidate(area_sqft)
      WHERE candidate.area_sqft > 0
      ORDER BY ABS(candidate.area_sqft - lp.parsed_area_sqft) NULLS LAST
      LIMIT 1
    ) closest_area ON TRUE
    WHERE m.property_status NOT IN ('Sold', 'Off Market', 'Archived', 'Rejected')
  ),
  findings AS (
    SELECT
      m.portal,
      m.portal_listing_id,
      m.listing_url,
      m.expires_on,
      m.property_id,
      m.property_title,
      m.property_code,
      m.property_status,
      m.listing_type,
      m.listing_price,
      m.listing_area_sqft,
      s.recent_leads AS lead_count,
      s.last_lead_at,
      NULL::TEXT AS parsed_property_type,
      NULL::NUMERIC AS parsed_price,
      NULL::NUMERIC AS parsed_area_sqft,
      'withdrawn_stock' AS drift_kind,
      1 AS kind_rank
    FROM mapped m
    JOIN lead_stats s ON s.mapped_id = m.mapped_id
    WHERE m.property_status IN ('Sold', 'Off Market', 'Archived', 'Rejected')
      AND s.recent_leads > 0

    UNION ALL

    SELECT
      m.portal,
      m.portal_listing_id,
      m.listing_url,
      m.expires_on,
      m.property_id,
      m.property_title,
      m.property_code,
      m.property_status,
      m.listing_type,
      m.listing_price,
      m.listing_area_sqft,
      s.leads_after_expiry,
      s.last_lead_at,
      NULL,
      NULL,
      NULL,
      'stale_expiry',
      2
    FROM mapped m
    JOIN lead_stats s ON s.mapped_id = m.mapped_id
    WHERE m.property_status NOT IN ('Sold', 'Off Market', 'Archived', 'Rejected')
      AND m.expires_on IS NOT NULL
      AND m.expires_on < CURRENT_DATE
      AND s.leads_after_expiry > 0

    UNION ALL

    SELECT
      dc.portal,
      dc.portal_listing_id,
      dc.listing_url,
      dc.expires_on,
      dc.property_id,
      dc.property_title,
      dc.property_code,
      dc.property_status,
      CASE WHEN dc.type_drift THEN dc.listing_type END,
      CASE WHEN dc.price_drift THEN dc.listing_price END,
      CASE WHEN dc.area_drift THEN dc.comparable_listing_area END,
      dc.recent_leads,
      dc.last_lead_at,
      CASE WHEN dc.type_drift THEN dc.parsed_property_type END,
      CASE WHEN dc.price_drift THEN dc.parsed_price END,
      CASE WHEN dc.area_drift THEN dc.parsed_area_sqft END,
      'details_drift',
      3
    FROM detail_comparison dc
    WHERE dc.type_drift OR dc.price_drift OR dc.area_drift

    UNION ALL

    SELECT
      m.portal,
      m.portal_listing_id,
      m.listing_url,
      m.expires_on,
      m.property_id,
      m.property_title,
      m.property_code,
      m.property_status,
      m.listing_type,
      m.listing_price,
      m.listing_area_sqft,
      s.leads_after_expiry,
      s.last_lead_at,
      NULL,
      NULL,
      NULL,
      'likely_lapsed',
      4
    FROM mapped m
    JOIN lead_stats s ON s.mapped_id = m.mapped_id
    WHERE m.property_status NOT IN ('Sold', 'Off Market', 'Archived', 'Rejected')
      AND m.expires_on IS NOT NULL
      AND m.expires_on < CURRENT_DATE - INTERVAL '14 days'
      AND s.leads_after_expiry = 0
  )
  SELECT
    f.portal,
    f.portal_listing_id,
    f.listing_url,
    f.expires_on,
    f.property_id,
    f.property_title,
    f.property_code,
    f.property_status,
    f.drift_kind,
    f.lead_count,
    f.last_lead_at,
    f.parsed_property_type,
    f.parsed_price,
    f.parsed_area_sqft,
    f.listing_type,
    f.listing_price,
    f.listing_area_sqft
  FROM findings f
  WHERE is_account_member(target_account_id)
  ORDER BY f.kind_rank, f.last_lead_at DESC NULLS LAST
  LIMIT 100;
$$;

COMMENT ON FUNCTION portal_listing_drift(UUID) IS
  'Mapped portal ads whose state has diverged from inventory, with portal-scoped snapshots and semantic area reconciliation. SECURITY DEFINER, guarded by is_account_member.';

REVOKE EXECUTE ON FUNCTION portal_listing_drift(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION portal_listing_drift(UUID) TO authenticated, service_role;
