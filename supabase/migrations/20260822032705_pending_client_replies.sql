-- ============================================================
-- 20260822032705_pending_client_replies.sql — the forwarded client reply whose
-- person the Engine could not name.
--
-- An agent forwards a chat in which their client answers about a
-- listing. When the screenshot yields no name the assistant could
-- match to the book, everything parsed out of that conversation was
-- thrown away and the agent was told to save the contact and forward
-- the chat again — even when the client was already in the book and
-- the agent said so in the next message.
--
-- The parse is parked here instead, one row per sender, and claimed
-- the moment the agent names the person. Short-lived by design (see
-- PENDING_CLIENT_REPLY_TTL_MS in
-- src/lib/journey/pending-client-reply.ts): filing one client's words
-- onto another client's journey is worse than losing them.
--
-- Written only by service-role webhook code; account members can read
-- their own rows. Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_client_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,

  parsed JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_client_replies_account
  ON pending_client_replies (account_id, updated_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON pending_client_replies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pending_client_replies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE pending_client_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_client_replies_select ON pending_client_replies;
CREATE POLICY pending_client_replies_select ON pending_client_replies FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS pending_client_replies_modify ON pending_client_replies;
CREATE POLICY pending_client_replies_modify ON pending_client_replies FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);
