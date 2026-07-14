-- ============================================================
-- Starred property filters — agents star up to 6 hot listings
-- in Inventory; each starred property surfaces as a quick-filter
-- chip on the Contacts page ("who showed interest in this?").
-- Unstarring removes the chip. The cap is enforced in the app
-- (UI + PUT handler), not the DB.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_properties_starred
  ON properties(account_id) WHERE is_starred = true;

COMMENT ON COLUMN properties.is_starred IS
  'Account-wide star: surfaces this property as an interest-filter chip on the Contacts page. App caps stars at 6 per account.';
