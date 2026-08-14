-- ============================================================
-- 270_voice_campaigns.sql
-- Qualification call campaigns (docs/voice-agent-integration-plan.md
-- §6): broadcast-style outbound voice-agent calls to a listing's
-- enquirers. Campaigns are dispatched by /api/cron/voice-campaigns
-- and resolved by the voice-agent webhook (campaign_id in its
-- payload). contacts.do_not_call is the opt-out every campaign
-- respects — set from a call, never cleared by one.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS do_not_call BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS voice_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  agent_ref TEXT,
  script_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  call_window_start_hour INTEGER NOT NULL DEFAULT 10
    CHECK (call_window_start_hour BETWEEN 0 AND 23),
  call_window_end_hour INTEGER NOT NULL DEFAULT 19
    CHECK (call_window_end_hour BETWEEN 1 AND 24),
  max_attempts INTEGER NOT NULL DEFAULT 3
    CHECK (max_attempts BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_campaigns_account
  ON voice_campaigns(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_campaigns_active
  ON voice_campaigns(status)
  WHERE status = 'active';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON voice_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE voice_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_campaigns_select
  ON voice_campaigns FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY voice_campaigns_insert
  ON voice_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY voice_campaigns_update
  ON voice_campaigns FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY voice_campaigns_delete
  ON voice_campaigns FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS voice_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES voice_campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'calling', 'completed', 'no_answer', 'failed', 'opted_out')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  call_log_id UUID REFERENCES contact_call_logs(id) ON DELETE SET NULL,
  qualification JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_campaign_recipients_dispatch
  ON voice_campaign_recipients(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_voice_campaign_recipients_account
  ON voice_campaign_recipients(account_id, created_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON voice_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE voice_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_campaign_recipients_select
  ON voice_campaign_recipients FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY voice_campaign_recipients_insert
  ON voice_campaign_recipients FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY voice_campaign_recipients_update
  ON voice_campaign_recipients FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY voice_campaign_recipients_delete
  ON voice_campaign_recipients FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Aggregated in SQL, not the browser (AGENTS.md §2.6): the campaign
-- list needs per-status recipient counts, and fetching every recipient
-- row to count client-side grows with campaign size instead of with
-- the answer.
CREATE OR REPLACE FUNCTION voice_campaign_recipient_counts(target_account_id UUID)
RETURNS TABLE (campaign_id UUID, status TEXT, recipients BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.campaign_id, r.status, COUNT(*) AS recipients
  FROM voice_campaign_recipients r
  WHERE r.account_id = target_account_id
    AND is_account_member(target_account_id)
  GROUP BY r.campaign_id, r.status;
$$;

COMMENT ON FUNCTION voice_campaign_recipient_counts(UUID) IS
  'Per-status recipient counts for an account''s voice campaigns. SECURITY DEFINER, guarded by is_account_member.';

-- PostgREST exposes public functions at /rest/v1/rpc/ and Supabase
-- grants EXECUTE to anon/authenticated as roles — anon must be named
-- or the browser anon key can call this with any account id
-- (migrations 263/265, same trap).
REVOKE EXECUTE ON FUNCTION voice_campaign_recipient_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION voice_campaign_recipient_counts(UUID) TO authenticated, service_role;
