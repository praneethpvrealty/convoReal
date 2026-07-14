-- ============================================================
-- Portal Post Kit — tracks where each property is advertised on
-- the external listing portals (99acres / MagicBricks / Housing).
--
-- Posting itself is manual (the portals expose no public APIs;
-- the CRM prepares copy-ready content and deep links). This table
-- records the outcome: which portal, the live listing URL, when it
-- was posted, and when it expires — so inventory cards can show
-- portal badges and the reminder cron can nudge the agent before
-- a paid listing silently lapses.
-- ============================================================

CREATE TABLE IF NOT EXISTS property_portal_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  portal TEXT NOT NULL CHECK (portal IN ('99acres', 'magicbricks', 'housing')),
  listing_url TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_on DATE,
  expiry_reminder_sent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'removed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, portal)
);

CREATE INDEX IF NOT EXISTS idx_portal_listings_account ON property_portal_listings(account_id);
CREATE INDEX IF NOT EXISTS idx_portal_listings_property ON property_portal_listings(property_id);
CREATE INDEX IF NOT EXISTS idx_portal_listings_expiry
  ON property_portal_listings(expires_on) WHERE status = 'active';

CREATE OR REPLACE FUNCTION update_portal_listing_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_listing_updated_at ON property_portal_listings;
CREATE TRIGGER trg_portal_listing_updated_at
  BEFORE UPDATE ON property_portal_listings
  FOR EACH ROW EXECUTE FUNCTION update_portal_listing_updated_at();

ALTER TABLE property_portal_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage own account portal listings" ON property_portal_listings;
CREATE POLICY "Members manage own account portal listings"
  ON property_portal_listings FOR ALL
  TO authenticated
  USING (
    account_id IN (
      SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid()
    )
  );
