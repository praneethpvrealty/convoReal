-- ============================================================
-- 063_add_update_sessions.sql
-- Creates update_sessions table to track active update 
-- sessions for properties and contacts via WhatsApp.
-- ============================================================

CREATE TABLE IF NOT EXISTS update_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  update_type TEXT NOT NULL CHECK (update_type IN ('property', 'contact')),
  target_id UUID NOT NULL, -- property_id or contact_id being updated
  target_identifier TEXT, -- e.g., property_code like 'PROP-1018'
  collected_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  pending_fields JSONB NOT NULL DEFAULT '[]'::jsonb, -- fields waiting to be collected
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'awaiting_confirmation', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id, status) -- only one active session per contact
);

-- Index for tenancy and lookup scoping
CREATE INDEX IF NOT EXISTS idx_update_sessions_contact ON update_sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_update_sessions_account ON update_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_update_sessions_target ON update_sessions(target_id);

-- Enable RLS
ALTER TABLE update_sessions ENABLE ROW LEVEL SECURITY;

-- Select policy: any member of the account can read
DROP POLICY IF EXISTS update_sessions_select ON update_sessions;
CREATE POLICY update_sessions_select ON update_sessions FOR SELECT USING (
  is_account_member(account_id)
);

-- Modify policy: agent or higher can insert/update/delete
DROP POLICY IF EXISTS update_sessions_modify ON update_sessions;
CREATE POLICY update_sessions_modify ON update_sessions FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Add update trigger for updated_at column
DROP TRIGGER IF EXISTS set_update_sessions_updated_at ON update_sessions;
CREATE TRIGGER set_update_sessions_updated_at BEFORE UPDATE ON update_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
