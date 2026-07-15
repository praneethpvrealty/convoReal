-- ============================================================
-- 126_owner_property_digest.sql
-- Periodic WhatsApp status digests to property OWNERS/SELLERS:
-- how many leads showed interest, shortlisted (entered the
-- pipeline), and scheduled site visits on their listings.
-- Sent daily or weekly per account, and ONLY when there is new
-- activity in the period. Owners can opt out anytime by replying
-- "STOP UPDATES" on WhatsApp (webhook-handler toggles the flag).
-- ============================================================

-- Per-account digest configuration (one row per account).
CREATE TABLE IF NOT EXISTS owner_digest_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 'off' | 'daily' | 'weekly' (weekly sends on Monday, IST)
  frequency TEXT NOT NULL DEFAULT 'off'
    CHECK (frequency IN ('off', 'daily', 'weekly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

ALTER TABLE owner_digest_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_digest_settings_select ON owner_digest_settings;
CREATE POLICY owner_digest_settings_select ON owner_digest_settings FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS owner_digest_settings_modify ON owner_digest_settings;
CREATE POLICY owner_digest_settings_modify ON owner_digest_settings FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_owner_digest_settings_updated_at ON owner_digest_settings;
CREATE TRIGGER set_owner_digest_settings_updated_at BEFORE UPDATE ON owner_digest_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- One row per digest actually attempted for an owner on a given IST
-- calendar day. The UNIQUE constraint is the dedup ledger: racing cron
-- ticks both INSERT, the loser gets 23505 and skips (same insert-as-
-- claim pattern as agent_digest_log, migration 119).
CREATE TABLE IF NOT EXISTS owner_digest_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  owner_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  -- Per-property stats snapshot: [{property_id,title,inquiries,shortlisted,visits,views}]
  stats JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 'freeform' | 'template' | 'failed' | 'skipped_no_template'
  channel TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, owner_contact_id, digest_date)
);

CREATE INDEX IF NOT EXISTS idx_owner_digest_log_account
  ON owner_digest_log(account_id, digest_date DESC);
CREATE INDEX IF NOT EXISTS idx_owner_digest_log_contact
  ON owner_digest_log(owner_contact_id);

ALTER TABLE owner_digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_digest_log_select ON owner_digest_log;
CREATE POLICY owner_digest_log_select ON owner_digest_log FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS owner_digest_log_modify ON owner_digest_log;
CREATE POLICY owner_digest_log_modify ON owner_digest_log FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Owner-side control: contacts can pause/resume their own digests by
-- replying "STOP UPDATES" / "START UPDATES" (or the template's quick
-- reply button) — no login required.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS owner_digest_opt_out BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN contacts.owner_digest_opt_out IS
  'Owner/seller opted out of periodic property status digests via WhatsApp reply.';
