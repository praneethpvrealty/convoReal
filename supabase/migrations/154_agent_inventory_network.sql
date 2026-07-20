-- ============================================================
-- 154_agent_inventory_network.sql
-- Agent inventory network: track who each property is shared with
-- (buyers vs partner agents), keep cross-account lineage when a
-- shared property is imported into another brokerage's CRM, and
-- send the ORIGINAL source agent a periodic WhatsApp digest of how
-- many direct and indirect buyers their inventory reached. Source
-- agents without a ConvoReal account get a signup invite with each
-- digest; once they sign up, the same reach data appears on their
-- dashboard (matched by phone, like Owners Den linking).
-- ============================================================

-- Cross-account lineage: the upstream property this row was imported
-- from (all tenants share one database, so a plain FK works). Set by
-- POST /api/inventory/import-shared; never exposed publicly.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS source_property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_properties_source_property
  ON properties(source_property_id) WHERE source_property_id IS NOT NULL;

COMMENT ON COLUMN properties.source_property_id IS
  'Upstream property this listing was imported from (co-broker share). Powers indirect-reach counting for the original source agent.';

-- One row per property × recipient the property was confirmed shared
-- with on WhatsApp. recipient_kind snapshots the contact''s
-- classification at share time so a later reclassification never
-- rewrites history. Re-shares are no-ops (UNIQUE + upsert-ignore).
CREATE TABLE IF NOT EXISTS property_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  recipient_kind TEXT NOT NULL DEFAULT 'buyer'
    CHECK (recipient_kind IN ('buyer', 'agent')),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, property_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_property_shares_property
  ON property_shares(property_id, recipient_kind);
CREATE INDEX IF NOT EXISTS idx_property_shares_account
  ON property_shares(account_id, created_at DESC);

ALTER TABLE property_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_shares_select ON property_shares;
CREATE POLICY property_shares_select ON property_shares FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS property_shares_modify ON property_shares;
CREATE POLICY property_shares_modify ON property_shares FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_property_shares_updated_at ON property_shares;
CREATE TRIGGER set_property_shares_updated_at BEFORE UPDATE ON property_shares
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Per-account digest configuration (one row per account), mirroring
-- owner_digest_settings (126). 'weekly' sends on Monday, IST.
CREATE TABLE IF NOT EXISTS agent_inventory_digest_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'off'
    CHECK (frequency IN ('off', 'daily', 'weekly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

ALTER TABLE agent_inventory_digest_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_inventory_digest_settings_select ON agent_inventory_digest_settings;
CREATE POLICY agent_inventory_digest_settings_select ON agent_inventory_digest_settings FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS agent_inventory_digest_settings_modify ON agent_inventory_digest_settings;
CREATE POLICY agent_inventory_digest_settings_modify ON agent_inventory_digest_settings FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_agent_inventory_digest_settings_updated_at ON agent_inventory_digest_settings;
CREATE TRIGGER set_agent_inventory_digest_settings_updated_at BEFORE UPDATE ON agent_inventory_digest_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- One row per digest actually attempted for a source agent on a given
-- IST calendar day — the insert-as-claim dedup ledger (same pattern as
-- owner_digest_log, migration 126).
CREATE TABLE IF NOT EXISTS agent_inventory_digest_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  -- Per-property reach snapshot:
  -- [{property_id,title,directBuyers,indirectBuyers,newDirectBuyers,newIndirectBuyers,agentsReached}]
  stats JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 'freeform' | 'template' | 'failed' | 'skipped_no_template'
  channel TEXT,
  -- Whether the signup invite line was included (source agent had no
  -- ConvoReal profile at send time).
  invite_included BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, agent_contact_id, digest_date)
);

CREATE INDEX IF NOT EXISTS idx_agent_inventory_digest_log_account
  ON agent_inventory_digest_log(account_id, digest_date DESC);
CREATE INDEX IF NOT EXISTS idx_agent_inventory_digest_log_contact
  ON agent_inventory_digest_log(agent_contact_id);

ALTER TABLE agent_inventory_digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_inventory_digest_log_select ON agent_inventory_digest_log;
CREATE POLICY agent_inventory_digest_log_select ON agent_inventory_digest_log FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS agent_inventory_digest_log_modify ON agent_inventory_digest_log;
CREATE POLICY agent_inventory_digest_log_modify ON agent_inventory_digest_log FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- ============================================================
-- Phone-based lookups, mirroring find_den_owner_contacts (132):
-- phone formats vary (+91, spaces, dashes), so the digit-stripping
-- must happen in SQL. Both are called with the service-role client
-- only; revoked from everyone else.
-- ============================================================

-- Does any ConvoReal profile exist for this phone? Decides whether the
-- digest carries a signup invite (no profile) or a dashboard pointer.
CREATE OR REPLACE FUNCTION public.phone_has_profile(p_phone_last10 TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_phone_last10 <> '' AND EXISTS (
    SELECT 1 FROM profiles pr
    WHERE right(regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g'), 10) = p_phone_last10
  );
$$;

REVOKE ALL ON FUNCTION public.phone_has_profile(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_has_profile(TEXT) FROM anon, authenticated;

-- All contact cards across tenants that represent this phone as a
-- SOURCE AGENT — i.e. referenced as owner_contact_id by at least one
-- agent-referred listing. Powers the signed-in agent's dashboard
-- network-reach view (one agent, many partner brokerages).
CREATE OR REPLACE FUNCTION public.find_agent_source_contacts(p_phone_last10 TEXT)
RETURNS TABLE (contact_id UUID, account_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.account_id
  FROM contacts c
  WHERE p_phone_last10 <> ''
    AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = p_phone_last10
    AND EXISTS (
      SELECT 1 FROM properties p
      WHERE p.owner_contact_id = c.id
        AND p.listing_source = 'agent'
    );
$$;

REVOKE ALL ON FUNCTION public.find_agent_source_contacts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_agent_source_contacts(TEXT) FROM anon, authenticated;
