-- 076_contact_call_logs.sql
-- Structured call log linked to contacts.
-- Agents log calls manually: date/time, direction, duration, outcome, notes.
-- Not IVR — this is a CRM call journal, not telephony integration.

CREATE TABLE IF NOT EXISTS contact_call_logs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  called_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  direction        TEXT NOT NULL DEFAULT 'outbound'
                     CHECK (direction IN ('outbound', 'inbound')),
  duration_seconds INTEGER CHECK (duration_seconds >= 0),
  outcome          TEXT NOT NULL DEFAULT 'connected'
                     CHECK (outcome IN (
                       'connected',
                       'no_answer',
                       'busy',
                       'voicemail',
                       'wrong_number',
                       'callback_requested'
                     )),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_contact
  ON contact_call_logs(contact_id, called_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_account
  ON contact_call_logs(account_id, called_at DESC);

ALTER TABLE contact_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_logs_select
  ON contact_call_logs FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY call_logs_insert
  ON contact_call_logs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY call_logs_delete
  ON contact_call_logs FOR DELETE
  USING (is_account_member(account_id, 'agent') AND user_id = auth.uid());
