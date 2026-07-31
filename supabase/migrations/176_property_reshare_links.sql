-- ============================================================
-- 176_property_reshare_links.sql
--
-- Who-shared-to-whom, per property. A co-broker holding a forwarded
-- showcase link can mint their OWN attributed link (?v=<their contact>);
-- this table records their upstream (parent) so a location-reveal
-- request can walk the full intermediary chain — each hop consents
-- before the listing owner's final decision. parent_contact_id NULL
-- means the listing side shared to them directly. The first recorded
-- parent wins: later mints must not rewire an existing chain.
-- ============================================================

CREATE TABLE IF NOT EXISTS property_reshare_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  parent_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_reshare_links_account
  ON property_reshare_links (account_id, property_id);

DROP TRIGGER IF EXISTS set_updated_at ON property_reshare_links;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON property_reshare_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE property_reshare_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reshare_links_select ON property_reshare_links;
CREATE POLICY reshare_links_select ON property_reshare_links FOR SELECT USING (
  is_account_member(account_id)
);

-- Rows are minted only by the public reshare route (service role) so a
-- forged parent can never be attached from the browser.
