-- ============================================================
-- Portal Inventory Sync — reverse flow of the Post Kit (121).
-- The Chrome extension harvests the agent's OWN "My Listings"
-- dashboard on 99acres / MagicBricks / Housing; the CRM stages
-- each scraped listing, matches it against existing inventory
-- and only creates properties the agent explicitly confirms.
--
-- Dedup guarantees live in the schema, not just app code:
--   * portal_import_items UNIQUE (account_id, portal,
--     portal_listing_id) — re-syncing upserts, never re-stages.
--   * property_portal_listings partial unique index on
--     (account_id, portal, portal_listing_id) — one portal
--     listing can only ever be linked to one CRM property.
--   * portal_import_items.matched_property_id records the link
--     once committed, so a committed item can never import twice.
-- ============================================================

-- ── 1. Portal identity + engagement stats on the link table ──

ALTER TABLE property_portal_listings
  ADD COLUMN IF NOT EXISTS portal_listing_id TEXT,
  ADD COLUMN IF NOT EXISTS views INTEGER,
  ADD COLUMN IF NOT EXISTS responses INTEGER,
  ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_listing_identity
  ON property_portal_listings (account_id, portal, portal_listing_id)
  WHERE portal_listing_id IS NOT NULL;

-- ── 2. Account-level portal stats (credits / plan) ───────────

CREATE TABLE IF NOT EXISTS portal_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  portal TEXT NOT NULL CHECK (portal IN ('99acres', 'magicbricks', 'housing')),
  remaining_listings INTEGER,
  remaining_refreshes INTEGER,
  plan_name TEXT,
  plan_expires_on DATE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, portal)
);

CREATE INDEX IF NOT EXISTS idx_portal_accounts_account ON portal_accounts(account_id);

ALTER TABLE portal_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage own portal accounts" ON portal_accounts;
CREATE POLICY "Members manage own portal accounts"
  ON portal_accounts FOR ALL
  TO authenticated
  USING (
    account_id IN (SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    account_id IN (SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid())
  );

DROP TRIGGER IF EXISTS trg_portal_accounts_updated_at ON portal_accounts;
CREATE TRIGGER trg_portal_accounts_updated_at
  BEFORE UPDATE ON portal_accounts
  FOR EACH ROW EXECUTE FUNCTION update_portal_listing_updated_at();

-- ── 3. Staging table for harvested listings ──────────────────
-- Raw scrape survives in raw_text/raw for re-parsing; parsed
-- columns power the review UI; match_* columns record what the
-- matcher decided and what the agent committed.

CREATE TABLE IF NOT EXISTS portal_import_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  portal TEXT NOT NULL CHECK (portal IN ('99acres', 'magicbricks', 'housing')),
  portal_listing_id TEXT NOT NULL,
  listing_url TEXT,
  raw_text TEXT,
  raw JSONB,
  title TEXT,
  property_type TEXT,
  listing_for TEXT,
  price NUMERIC,
  bedrooms INTEGER,
  area_sqft NUMERIC,
  locality TEXT,
  city TEXT,
  posted_on DATE,
  expires_on DATE,
  portal_status TEXT,
  views INTEGER,
  responses INTEGER,
  match_status TEXT NOT NULL DEFAULT 'new'
    CHECK (match_status IN ('auto_matched', 'review', 'new', 'imported', 'linked', 'ignored')),
  matched_property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  match_confidence NUMERIC,
  match_reasons TEXT[],
  match_candidates JSONB,
  batch_group TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, portal, portal_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_import_account ON portal_import_items(account_id);
CREATE INDEX IF NOT EXISTS idx_portal_import_status ON portal_import_items(account_id, match_status);

ALTER TABLE portal_import_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage own portal imports" ON portal_import_items;
CREATE POLICY "Members manage own portal imports"
  ON portal_import_items FOR ALL
  TO authenticated
  USING (
    account_id IN (SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    account_id IN (SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid())
  );

DROP TRIGGER IF EXISTS trg_portal_import_updated_at ON portal_import_items;
CREATE TRIGGER trg_portal_import_updated_at
  BEFORE UPDATE ON portal_import_items
  FOR EACH ROW EXECUTE FUNCTION update_portal_listing_updated_at();
