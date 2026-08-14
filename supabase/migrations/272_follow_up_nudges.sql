-- ============================================================
-- 272_follow_up_nudges.sql — per-lead state for the follow-up radar.
--
-- A hot lead who said "we can talk whenever" went six days unanswered
-- because the only watchdog was a panel on /today that nobody is
-- obliged to open. The daily follow-up cron now sends the agent a
-- WhatsApp card per quiet hot lead; this table is what keeps that from
-- becoming spam. One row per (account, contact): when the last card
-- went out, and until when the agent snoozed the lead.
--
-- Written by service-role cron/webhook code; account members can read
-- their own rows. Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS follow_up_nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  last_nudged_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_nudges_account
  ON follow_up_nudges (account_id, last_nudged_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON follow_up_nudges;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON follow_up_nudges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE follow_up_nudges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follow_up_nudges_select ON follow_up_nudges;
CREATE POLICY follow_up_nudges_select ON follow_up_nudges FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS follow_up_nudges_modify ON follow_up_nudges;
CREATE POLICY follow_up_nudges_modify ON follow_up_nudges FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);
