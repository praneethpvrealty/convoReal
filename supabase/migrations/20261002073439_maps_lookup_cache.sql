-- Google Maps lookups are billed per call once past the free tier, and
-- two paths were paying for the same answer again and again: the
-- near-search self-heal re-geocoded every property Google could not
-- resolve on every search, and the showcase place cache lived in
-- process memory, so each cold start bought every popular area afresh.
--
-- maps_lookup_cache holds one row per (kind, key): a geocoded address,
-- a reverse-geocoded coordinate pair, or a showcase area lookup. It is
-- a cache of public geography shared by every account, so it carries no
-- account_id; only the service role reads or writes it. Entries expire
-- after 30 days, the longest Google's terms allow geocoding results to
-- be cached.
--
-- properties.geocode_attempted_at records the last time an address
-- geocode came back empty, so the self-heal tier can leave the row
-- alone for a month instead of retrying it on every radius search.

CREATE TABLE IF NOT EXISTS maps_lookup_cache (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS maps_lookup_cache_expires_at_idx
  ON maps_lookup_cache (expires_at);

-- Service-role only: RLS on, zero policies.
ALTER TABLE maps_lookup_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS geocode_attempted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS properties_ungeocoded_idx
  ON properties (account_id, geocode_attempted_at)
  WHERE latitude IS NULL;
