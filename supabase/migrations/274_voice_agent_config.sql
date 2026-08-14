-- ============================================================
-- 274_voice_agent_config.sql
-- Phase B of docs/voice-agent-integration-plan.md: per-account voice
-- provider configuration. Replaces the single global
-- VOICE_AGENT_WEBHOOK_TOKEN (kept as a deprecation fallback) with a
-- per-account webhook token, carries the account's default agent_ref
-- so campaigns and reminder calls need not repeat it, and gates
-- reminder calls behind an explicit opt-in.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS voice_agent_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  agent_ref TEXT,
  phone_number TEXT,
  webhook_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_calls_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON voice_agent_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE voice_agent_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_agent_config_select
  ON voice_agent_config FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY voice_agent_config_insert
  ON voice_agent_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY voice_agent_config_update
  ON voice_agent_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY voice_agent_config_delete
  ON voice_agent_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));
