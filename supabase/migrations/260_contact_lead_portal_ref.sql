-- ============================================================
-- 260_contact_lead_portal_ref.sql
--
-- The portal ad a lead actually enquired about, kept on the contact.
--
-- property_portal_listings already holds the one-to-one map between a
-- portal's ad id and an Engine property (migration 124's partial unique
-- index on (account_id, portal, portal_listing_id) is what makes it one
-- to one), and the lead webhook already resolves a lead through it
-- before it scores anything. What was missing is the first assertion:
-- until an agent says "this Housing ad IS this listing" there is no row
-- to resolve through, so every lead on that ad falls back to guessing
-- by type/locality/price.
--
-- These two columns carry the ad's identity on the lead itself, so the
-- agent can make that assertion from the contact in front of them, and
-- so asserting it can retro-tag every other lead that quoted the same
-- ad and is still waiting.
--
-- Nullable by nature: leads arrive by WhatsApp, referral and manual
-- entry too, and those have no portal ad behind them.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_portal TEXT,
  ADD COLUMN IF NOT EXISTS lead_portal_listing_id TEXT;

COMMENT ON COLUMN contacts.lead_portal IS
  'Portal whose ad this lead came in on: 99acres | magicbricks | housing. Null for non-portal leads.';
COMMENT ON COLUMN contacts.lead_portal_listing_id IS
  'The portal''s own ad id as quoted in the lead email. Matched against property_portal_listings.portal_listing_id for exact attribution.';

-- Drives both the retro-tag sweep after an agent asserts a mapping and
-- the "ads still unmapped" queue, which are the same lookup.
CREATE INDEX IF NOT EXISTS idx_contacts_lead_portal_ref
  ON contacts (account_id, lead_portal, lead_portal_listing_id)
  WHERE lead_portal_listing_id IS NOT NULL;
