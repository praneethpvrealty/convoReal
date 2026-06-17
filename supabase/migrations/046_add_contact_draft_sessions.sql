-- ============================================================
-- 046_add_contact_draft_sessions.sql
-- Creates contact_draft_sessions table to track active chatbot 
-- contact parsing sessions per owner/contact.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_draft_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  draft_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'awaiting_confirmation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id)
);

-- Index for tenancy and lookup scoping
CREATE INDEX IF NOT EXISTS idx_contact_draft_sessions_contact ON contact_draft_sessions(contact_id);

-- Enable RLS
ALTER TABLE contact_draft_sessions ENABLE ROW LEVEL SECURITY;

-- Select policy: any member of the account can read
DROP POLICY IF EXISTS contact_draft_sessions_select ON contact_draft_sessions;
CREATE POLICY contact_draft_sessions_select ON contact_draft_sessions FOR SELECT USING (
  is_account_member(account_id)
);

-- Modify policy: agent or higher can insert/update/delete
DROP POLICY IF EXISTS contact_draft_sessions_modify ON contact_draft_sessions;
CREATE POLICY contact_draft_sessions_modify ON contact_draft_sessions FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Add update trigger for updated_at column
DROP TRIGGER IF EXISTS set_contact_draft_sessions_updated_at ON contact_draft_sessions;
CREATE TRIGGER set_contact_draft_sessions_updated_at BEFORE UPDATE ON contact_draft_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
