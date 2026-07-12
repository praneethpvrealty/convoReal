-- ============================================================
-- Data foundation: consent, sold-price capture, anonymized market stats.
--
-- 1. accounts.data_sharing_consent — explicit OPT-IN (default false),
--    owner-only, timestamped + attributed for DPDP diligence. Gates
--    every read the market-stats aggregation makes: non-consenting
--    accounts' data never enters the pipeline.
-- 2. properties.sold_price — optional final sale price captured when a
--    listing is marked Sold. Asking-vs-sold delta is the core signal of
--    the future market dataset. Never shown to buyers.
-- 3. market_stats — nightly ANONYMIZED rollups (supply & demand cells
--    per month × geography × type). k-anonymity is enforced by the
--    engine (cells backed by fewer than K distinct accounts are never
--    written). Service-role only: RLS on, zero policies — the future
--    Market Pulse API will gate reads on consent at the app layer.
--
-- Engine: src/lib/market/stats-engine.ts. Config: system_settings key
-- `market_stats_config` (ships disabled).
-- ============================================================

-- ── 1. Account-level data-sharing consent ────────────────────────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS data_sharing_consent    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_sharing_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_sharing_consent_by UUID;

-- ── 2. Sold-price capture ────────────────────────────────────────────────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS sold_price NUMERIC;

-- ── 3. Anonymized market rollups ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_stats (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month       DATE NOT NULL,               -- first day of the month bucket
  side               TEXT NOT NULL CHECK (side IN ('supply', 'demand')),
  city               TEXT NOT NULL,
  locality           TEXT NOT NULL,               -- COALESCE(locality_canonical, sublocality) / normalized area
  property_type      TEXT NOT NULL,
  listing_type       TEXT NOT NULL DEFAULT 'Sale',
  -- supply metrics
  listings_count     INT,
  median_price       NUMERIC,
  median_area_sqft   NUMERIC,
  sold_count         INT,
  median_sold_price  NUMERIC,
  median_days_to_sell NUMERIC,
  -- demand metrics
  buyer_count        INT,
  median_budget      NUMERIC,
  -- k-anonymity provenance: distinct consenting accounts behind the cell
  accounts_count     INT NOT NULL,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_month, side, city, locality, property_type, listing_type)
);

-- Service-role only: RLS on with no policies. Aggregates are non-personal,
-- but read access will be granted through a consent-gated API, not RLS.
ALTER TABLE market_stats ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_market_stats_lookup
  ON market_stats (city, locality, period_month DESC);
