-- ============================================================
-- 185: bot_message_targets — what a bot confirmation was about.
--
-- The owner chatbot answers an ingested screenshot/voice note/text
-- with a card ("✅ Added to your calendar", "✅ Property listing
-- created"). Quote-replying that card with a correction ("change
-- this to Monday 5pm") used to be read as a brand-new request, so a
-- fix produced a SECOND appointment instead of editing the first.
--
-- WhatsApp puts the quoted card's wamid on the reply as context.id,
-- so all that was missing is a way back from that wamid to the row
-- the card announced. Same shape as appointment_reminder_log.
-- wa_message_id, which already matches reminder button taps.
--
-- One row per outbound confirmation; UNIQUE on (account, wamid)
-- because a wamid identifies exactly one message.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_message_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  wa_message_id TEXT NOT NULL,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('appointment', 'todo', 'contact', 'property')),
  entity_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_message_targets_lookup
  ON bot_message_targets(account_id, wa_message_id);

DROP TRIGGER IF EXISTS set_updated_at ON bot_message_targets;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON bot_message_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bot_message_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read bot message targets" ON bot_message_targets;
CREATE POLICY "Members read bot message targets" ON bot_message_targets
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "Members write bot message targets" ON bot_message_targets;
CREATE POLICY "Members write bot message targets" ON bot_message_targets
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

COMMENT ON TABLE bot_message_targets IS
  'Maps an outbound bot confirmation wamid to the row it announced, so a quote-reply correction edits that row instead of creating a duplicate.';
