-- ============================================================
-- 267_portal_listing_drift.sql
--
-- Ad ↔ listing drift, computed from data already on hand.
--
-- Once an ad is mapped (migration 264) the Engine knows which listing
-- every portal lead belongs to — but nothing tells it when the two
-- sides diverge. Observed 13 Aug 2026: PROP-1083 was Archived in the
-- Engine while its MagicBricks ad (85514527) was live, approved, and
-- had produced three leads in four days. Every fact needed to flag
-- that was already in the database; this migration is the flagging.
--
-- Four drift kinds, per FEATURE_ROADMAP.md Milestone 4:
--   withdrawn_stock  leads still arriving on an ad whose listing is
--                    Sold/Archived/Off Market/Rejected — an ad is
--                    being paid for on withdrawn stock.
--   stale_expiry     leads arriving after the recorded expires_on —
--                    the recorded expiry is stale, not the ad.
--   likely_lapsed    no leads well past expires_on — the ad probably
--                    lapsed; the expiry nudge fired but never learned
--                    the outcome.
--   details_drift    the ad's parsed type/price/area (from its most
--                    recent lead email) diverging from the listing's —
--                    one side was edited and the other was not.
-- ============================================================

-- ── The ad id on the sync log, next to the parsed enquiry ────
--
-- Migration 200 records what each lead email asked for; migration 264
-- records which ad a lead quoted — but on the contact, not the log.
-- Carrying the ad id here links "what the ad currently says" to the ad
-- itself, which is what details_drift compares. Older logs are reached
-- through matched_property_id + the exact-match score instead.
ALTER TABLE email_sync_logs
  ADD COLUMN IF NOT EXISTS lead_portal TEXT,
  ADD COLUMN IF NOT EXISTS lead_portal_listing_id TEXT;

COMMENT ON COLUMN email_sync_logs.lead_portal IS
  'Portal whose ad the lead email quoted: 99acres | magicbricks | housing. Null when the email carried no ad id.';
COMMENT ON COLUMN email_sync_logs.lead_portal_listing_id IS
  'The portal''s own ad id as quoted in the lead email, alongside the parsed enquiry — what portal_listing_drift() compares against the listing.';

CREATE INDEX IF NOT EXISTS idx_email_sync_logs_portal_ad
  ON email_sync_logs (account_id, lead_portal, lead_portal_listing_id, created_at DESC)
  WHERE lead_portal_listing_id IS NOT NULL;

-- One-time backfill from the contacts the retro-tag sweep already
-- tagged (migration 264): a lead's log and its contact describe the
-- same email, joined here by normalized phone within the account. The
-- heuristic-era logs otherwise stay unreachable — their match_score is
-- 2-5, not the exact-match 100, even when the ad id is now known.
UPDATE email_sync_logs l
SET lead_portal = c.lead_portal,
    lead_portal_listing_id = c.lead_portal_listing_id
FROM contacts c
WHERE c.account_id = l.account_id
  AND c.lead_portal_listing_id IS NOT NULL
  AND l.lead_portal_listing_id IS NULL
  AND l.extracted_phone IS NOT NULL
  AND regexp_replace(l.extracted_phone, '\D', '', 'g') = regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g');

-- ── The drift findings, one row per (ad, kind) ───────────────
--
-- Aggregated here rather than in the browser (AGENTS.md §2.6): the
-- alternative ships every portal lead and sync log to the client.
-- Stateless by design — a finding disappears when the underlying
-- condition is fixed (listing relisted, expiry updated, ad marked
-- removed), so there is no dismissal state to store or to go stale.
--
-- Tolerances mirror the lead scorer's (email-webhook route): a type
-- counts as matching when either contains the other or they share a
-- word longer than two characters; price and area tolerate 10%.
-- details_drift means the scorer itself would score that field at 0 —
-- the same lead that mapped the ad would no longer look like it.
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
      p.area_sqft AS listing_area_sqft
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
       OR (l.matched_property_id = m.property_id AND l.match_score >= 100)
     )
     AND (l.parsed_property_type IS NOT NULL OR l.parsed_price IS NOT NULL OR l.parsed_area_sqft IS NOT NULL)
    ORDER BY m.mapped_id, l.created_at DESC
  ),
  findings AS (
    SELECT m.*, s.recent_leads AS lead_count, s.last_lead_at,
           NULL::TEXT AS parsed_property_type, NULL::NUMERIC AS parsed_price, NULL::NUMERIC AS parsed_area_sqft,
           'withdrawn_stock' AS drift_kind, 1 AS kind_rank
    FROM mapped m
    JOIN lead_stats s ON s.mapped_id = m.mapped_id
    WHERE m.property_status IN ('Sold', 'Off Market', 'Archived', 'Rejected')
      AND s.recent_leads > 0

    UNION ALL

    SELECT m.*, s.leads_after_expiry, s.last_lead_at,
           NULL, NULL, NULL,
           'stale_expiry', 2
    FROM mapped m
    JOIN lead_stats s ON s.mapped_id = m.mapped_id
    WHERE m.property_status NOT IN ('Sold', 'Off Market', 'Archived', 'Rejected')
      AND m.expires_on IS NOT NULL
      AND m.expires_on < CURRENT_DATE
      AND s.leads_after_expiry > 0

    UNION ALL

    SELECT m.*, s.recent_leads, s.last_lead_at,
           lp.parsed_property_type, lp.parsed_price, lp.parsed_area_sqft,
           'details_drift', 3
    FROM mapped m
    JOIN lead_stats s ON s.mapped_id = m.mapped_id
    JOIN latest_parsed lp ON lp.mapped_id = m.mapped_id
    WHERE m.property_status NOT IN ('Sold', 'Off Market', 'Archived', 'Rejected')
      AND (
        (
          lp.parsed_property_type IS NOT NULL AND m.listing_type IS NOT NULL
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
        )
        OR (
          lp.parsed_price IS NOT NULL AND m.listing_price IS NOT NULL AND m.listing_price > 0
          AND ABS(lp.parsed_price - m.listing_price) > m.listing_price * 0.10
        )
        OR (
          lp.parsed_area_sqft IS NOT NULL AND m.listing_area_sqft IS NOT NULL AND m.listing_area_sqft > 0
          AND ABS(lp.parsed_area_sqft - m.listing_area_sqft) > m.listing_area_sqft * 0.10
        )
      )

    UNION ALL

    SELECT m.*, s.leads_after_expiry, s.last_lead_at,
           NULL, NULL, NULL,
           'likely_lapsed', 4
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
  'Mapped portal ads whose recorded state has diverged from reality: withdrawn stock still advertised, stale expiries, silently lapsed ads, edited details. SECURITY DEFINER, guarded by is_account_member.';

-- Grants must be named, not left to PUBLIC (migrations 263/264): the
-- default privileges grant EXECUTE to anon as a role, which survives a
-- PUBLIC revoke, and PostgREST exposes every public function to the
-- anon key that ships in the browser bundle.
REVOKE EXECUTE ON FUNCTION portal_listing_drift(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION portal_listing_drift(UUID) TO authenticated, service_role;
