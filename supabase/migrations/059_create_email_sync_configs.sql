-- Migration 059: Create email_sync_configs table for multi-tenant lead sync management
CREATE TABLE IF NOT EXISTS email_sync_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  auto_reply_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  auto_reply_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE email_sync_configs ENABLE ROW LEVEL SECURITY;

-- Policies using the standard is_account_member helper
DROP POLICY IF EXISTS email_sync_configs_select ON email_sync_configs;
DROP POLICY IF EXISTS email_sync_configs_insert ON email_sync_configs;
DROP POLICY IF EXISTS email_sync_configs_update ON email_sync_configs;
DROP POLICY IF EXISTS email_sync_configs_delete ON email_sync_configs;

CREATE POLICY email_sync_configs_select ON email_sync_configs FOR SELECT USING (is_account_member(account_id));
CREATE POLICY email_sync_configs_insert ON email_sync_configs FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY email_sync_configs_update ON email_sync_configs FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY email_sync_configs_delete ON email_sync_configs FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Trigger updated_at
DROP TRIGGER IF EXISTS set_updated_at ON email_sync_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_sync_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
