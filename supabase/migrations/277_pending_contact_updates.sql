-- ============================================================
-- 277_pending_contact_updates.sql — the update an agent dictated for
-- someone who turned out to be a contact rather than a teammate.
--
-- A teammate update is delivered the moment it is dictated: it stays
-- inside the account. A contact update leaves it — the client reads it
-- on their own phone — so the bot asks first and holds the drafted text
-- here until the agent replies "yes" (or lets it lapse).
--
-- One row per conversation: a second unconfirmed update replaces the
-- first, because the agent has plainly moved on from it. Read and
-- written by the service-role owner-chatbot path; account members can
-- read their own rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_contact_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contact_name TEXT,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_contact_updates_account
  ON pending_contact_updates (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON pending_contact_updates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pending_contact_updates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE pending_contact_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_contact_updates_select ON pending_contact_updates;
CREATE POLICY pending_contact_updates_select ON pending_contact_updates FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS pending_contact_updates_modify ON pending_contact_updates;
CREATE POLICY pending_contact_updates_modify ON pending_contact_updates FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);
