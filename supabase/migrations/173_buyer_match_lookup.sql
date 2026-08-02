-- ============================================================
-- 173_buyer_match_lookup.sql — indexes for the buyer portal's
-- "matched to your brief" feed (/api/buyer/matches).
--
-- Two reads back that feed, and neither had an index that fits:
--
--   1. Every published, available listing from each agency the buyer
--      is linked to, most recent first — the pool the ranking engine
--      scores. idx_properties_account_published_status covers the
--      account_id + is_published + status predicate that the showcase
--      queries use too.
--
--   2. Deal Mode events in the buyer's own account whose matches[]
--      array names their contact. idx_match_events_deal_mode
--      (migration 134) serves the sweep's dedupe lookup by
--      property_id, but the buyer read filters on jsonb containment
--      instead, which needs GIN to stay off a sequential scan.
--
-- No new tables and no policy changes: buyer_users, buyer_contact_links
-- and find_buyer_contacts (migration 160) already carry the identity.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_properties_account_published_status
  ON properties (account_id, is_published, status);

CREATE INDEX IF NOT EXISTS idx_match_events_matches_gin
  ON match_events USING GIN (matches jsonb_path_ops);
