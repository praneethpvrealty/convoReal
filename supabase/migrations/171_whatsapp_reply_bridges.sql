-- ============================================================
-- 171_whatsapp_reply_bridges.sql
--
-- Direct WhatsApp replies to leads.
--
-- When ConvoReal pings a staff member's own WhatsApp about a lead
-- ("New lead just messaged you"), the wamid of that ping is recorded
-- here against the lead's conversation. A WhatsApp quote-reply to the
-- ping arrives on the webhook carrying `context.id` = that wamid,
-- which is how the inbound handler knows the text is meant for the
-- lead — and not for the owner chatbot or the digest commands that
-- otherwise own staff-side traffic.
--
-- One row per outbound bridge message (the ping, the "sent" ack, and
-- each relayed lead reply), so any of them can be quoted to continue.
-- `last_agent_reply_at` is stamped the first time the agent actually
-- answers from WhatsApp: that opt-in is what turns on mirroring the
-- lead's later messages to their phone.
--
-- Rows are written only by the service-role side (reply-bridge.ts);
-- members get SELECT so the dashboard can surface bridged threads.
-- A bridge is useless once Meta's 24-hour customer service window on
-- the lead closes, so registration prunes rows past the grace period.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_reply_bridges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The staff member we pinged. Replies are accepted only from this
  -- phone, and relays go back to it.
  agent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_phone TEXT NOT NULL,
  -- wamid of the outbound ping/ack/relay the agent quote-replies to.
  notification_message_id TEXT NOT NULL UNIQUE,
  target_conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  target_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  last_agent_reply_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Freshest opt-in bridge for a thread: "is this lead being handled
-- from WhatsApp, and by whom?"
CREATE INDEX IF NOT EXISTS idx_reply_bridges_conversation
  ON whatsapp_reply_bridges (target_conversation_id, last_agent_reply_at DESC NULLS LAST);

-- Prune scan.
CREATE INDEX IF NOT EXISTS idx_reply_bridges_account_created
  ON whatsapp_reply_bridges (account_id, created_at);

ALTER TABLE whatsapp_reply_bridges ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_whatsapp_reply_bridges_updated_at ON whatsapp_reply_bridges;
CREATE TRIGGER set_whatsapp_reply_bridges_updated_at BEFORE UPDATE ON whatsapp_reply_bridges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS whatsapp_reply_bridges_select ON whatsapp_reply_bridges;
CREATE POLICY whatsapp_reply_bridges_select ON whatsapp_reply_bridges FOR SELECT USING (
  is_account_member(account_id)
);
