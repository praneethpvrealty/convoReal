-- ============================================================
-- 237_message_private_notes.sql
--
-- Internal notes on a conversation.
--
-- A staff command typed in the inbox (SET BUDGET 2CR) is intercepted
-- before the send: it changes the contact and never reaches WhatsApp.
-- Its acknowledgement still belongs in the thread — the record of who
-- changed a brief reads best next to the conversation it came from —
-- so it is written as a message flagged private, which the inbox
-- renders as a centred internal note rather than an outgoing bubble.
--
-- Defaulted and NOT NULL, so every existing row is a normal message
-- and every reader that ignores the column behaves exactly as before.
-- The only writer is the agent-command path; the only reader is
-- MessageBubble.
--
-- Note for anyone checking this column exists: `realtime.messages`
-- (Supabase's own internal table) also has a `private` column. An
-- information_schema query without a table_schema filter returns
-- that one and looks like proof this migration already ran.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS private BOOLEAN NOT NULL DEFAULT false;
