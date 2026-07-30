-- Covering index for the showcase freshness probe.
--
-- Every public showcase render asks for the account's published-and-
-- available listing count plus the newest updated_at, and uses that pair
-- as the cache key for the catalogue (src/lib/showcase/public-data.ts).
-- idx_properties_account_published_status already serves the filter, but
-- max(updated_at) had to visit the heap for every matching row; adding
-- updated_at to the key makes the probe an index-only scan that reads a
-- single entry for the max and counts the rest in the index.

CREATE INDEX IF NOT EXISTS idx_properties_showcase_version
  ON properties (account_id, is_published, status, updated_at DESC);
