-- ============================================================
-- 125_whatsapp_meta_flows.sql
-- Native Meta WhatsApp Flows (form-screen flows).
--
-- NOT to be confused with the in-app chatbot flow builder
-- (`flows` / `flow_runs`, migrations 010/016/077). These tables
-- track flows created on Meta's platform via the Graph API and
-- the per-send flow tokens used by the encrypted data-exchange
-- endpoint (/api/whatsapp/flows/endpoint/[accountId]).
-- ============================================================

-- Registry of flows created on Meta for each account.
CREATE TABLE IF NOT EXISTS whatsapp_meta_flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Internal identifier of the flow blueprint, e.g. 'preference_intake'.
  flow_key TEXT NOT NULL,
  -- Meta's flow id, assigned when the flow is created via Graph API.
  meta_flow_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'deprecated', 'error')),
  -- Flow JSON schema version uploaded to Meta (e.g. '7.2').
  flow_json_version TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, flow_key)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_flows_account
  ON whatsapp_meta_flows(account_id);

ALTER TABLE whatsapp_meta_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_meta_flows_select ON whatsapp_meta_flows;
CREATE POLICY whatsapp_meta_flows_select ON whatsapp_meta_flows FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS whatsapp_meta_flows_modify ON whatsapp_meta_flows;
CREATE POLICY whatsapp_meta_flows_modify ON whatsapp_meta_flows FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_whatsapp_meta_flows_updated_at ON whatsapp_meta_flows;
CREATE TRIGGER set_whatsapp_meta_flows_updated_at BEFORE UPDATE ON whatsapp_meta_flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- One row per flow message sent to a contact. The flow_token is the
-- opaque value Meta echoes back on every data-exchange request and in
-- the final nfm_reply webhook — it is how we map a form submission
-- back to the tenant + contact without trusting client input.
CREATE TABLE IF NOT EXISTS whatsapp_meta_flow_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  flow_key TEXT NOT NULL,
  flow_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'opened', 'completed', 'expired', 'cancelled')),
  -- Snapshot of the prefill data at send time (debugging aid; the
  -- endpoint re-reads the contact on INIT for fresh values).
  prefill JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Raw form values from the final data_exchange / nfm_reply.
  response JSONB,
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_flow_sessions_contact
  ON whatsapp_meta_flow_sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_flow_sessions_account
  ON whatsapp_meta_flow_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_flow_sessions_token
  ON whatsapp_meta_flow_sessions(flow_token);

ALTER TABLE whatsapp_meta_flow_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_meta_flow_sessions_select ON whatsapp_meta_flow_sessions;
CREATE POLICY whatsapp_meta_flow_sessions_select ON whatsapp_meta_flow_sessions FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS whatsapp_meta_flow_sessions_modify ON whatsapp_meta_flow_sessions;
CREATE POLICY whatsapp_meta_flow_sessions_modify ON whatsapp_meta_flow_sessions FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_whatsapp_meta_flow_sessions_updated_at ON whatsapp_meta_flow_sessions;
CREATE TRIGGER set_whatsapp_meta_flow_sessions_updated_at BEFORE UPDATE ON whatsapp_meta_flow_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RSA-2048 keypair used by Meta to encrypt data-exchange requests to
-- our Flows endpoint. The private key PEM is stored encrypted with the
-- same AES-256-GCM helper as access_token (src/lib/whatsapp/encryption.ts).
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS flows_private_key TEXT,
  ADD COLUMN IF NOT EXISTS flows_public_key TEXT,
  ADD COLUMN IF NOT EXISTS flows_key_registered_at TIMESTAMPTZ;

COMMENT ON COLUMN whatsapp_config.flows_private_key IS
  'Encrypted (AES-256-GCM) PKCS8 PEM private key for WhatsApp Flows data-exchange endpoint decryption.';
COMMENT ON COLUMN whatsapp_config.flows_public_key IS
  'SPKI PEM public key registered with Meta via /{phone_number_id}/whatsapp_business_encryption.';
COMMENT ON COLUMN whatsapp_config.flows_key_registered_at IS
  'When the public key was last successfully registered with Meta.';
