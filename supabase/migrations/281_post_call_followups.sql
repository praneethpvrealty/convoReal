-- Post-call follow-ups (docs/post-call-followup-plan.md).
-- What happens on WhatsApp after a voice call ends, decided by the
-- call's disposition. One flow-agnostic table: a row per call the
-- playbook decided to act on, including the ones it decided to skip —
-- a follow-up not sent because a template was Marketing-capped or the
-- lead opted out should be visible, not absent.

ALTER TABLE contact_call_logs
  ADD COLUMN IF NOT EXISTS disposition TEXT;

CREATE TABLE IF NOT EXISTS outreach_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  call_log_id UUID REFERENCES contact_call_logs(id) ON DELETE SET NULL,

  flow_kind TEXT NOT NULL DEFAULT 'buyer_qualification'
    CHECK (flow_kind IN ('buyer_qualification', 'owner_onboarding')),
  disposition TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('matches', 'note', 'handoff', 'checkin')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'opened', 'completed', 'skipped', 'failed')),

  -- NULL = send now; a date = the long game (not_now, callbacks).
  scheduled_for TIMESTAMPTZ,

  window_was_open BOOLEAN,
  template_used TEXT,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  skip_reason TEXT,

  -- Snapshot of what the call stated (budget/areas text, agent name),
  -- so the rich follow-up a tap triggers days later still speaks to
  -- what was actually said.
  context JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One follow-up per call: a redelivered webhook must not double-message.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_followups_call
  ON outreach_followups (account_id, call_log_id)
  WHERE call_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outreach_followups_account
  ON outreach_followups (account_id, created_at DESC);

-- The sweep: pending rows whose date has arrived.
CREATE INDEX IF NOT EXISTS idx_outreach_followups_due
  ON outreach_followups (scheduled_for)
  WHERE status = 'pending' AND scheduled_for IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON outreach_followups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON outreach_followups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE outreach_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outreach_followups_select ON outreach_followups;
CREATE POLICY outreach_followups_select ON outreach_followups FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS outreach_followups_modify ON outreach_followups;
CREATE POLICY outreach_followups_modify ON outreach_followups FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);
