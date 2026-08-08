-- ============================================================
-- 217_message_pin_and_hide.sql
-- Pinning a message, and hiding one from the Engine inbox.
--
-- BOTH ARE ENGINE-LOCAL FOR ONE-TO-ONE THREADS. Read this before
-- wiring either into anything that talks to a customer:
--
--   Pin — the Cloud API's pin endpoint (type: 'pin' on /messages)
--   only accepts recipient_type 'group'. There is no pin for a 1:1
--   chat, so `pinned_at` on a normal thread is a marker for the team
--   and nothing on the contact's phone changes. `pin_expires_at` is
--   here for the group case, where Meta expires a pin after 1-30 days.
--
--   Hide — Meta has NO revoke or delete endpoint. A message that has
--   been sent cannot be recalled, by us or by anyone using the
--   official API. `deleted_at` removes a row from the Engine's own
--   thread only. The UI must say "delete for me" and never imply the
--   customer's copy went anywhere, because it did not.
--
-- Kept as columns on `messages` rather than a side table: both are
-- one nullable fact per message, every read of them is already reading
-- the message, and the thread query must filter on deleted_at.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Set only for group pins, which Meta expires on its own.
  ADD COLUMN IF NOT EXISTS pin_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- The pinned bar reads "pinned messages in this conversation", which is
-- a tiny slice of a large table; partial so the index stays the size of
-- the answer rather than the size of the thread.
CREATE INDEX IF NOT EXISTS idx_messages_pinned
  ON messages(conversation_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

-- Every thread read now carries "and not hidden". Without this the
-- filter turns the existing conversation_id scan into a filtered scan
-- over the same rows.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_visible
  ON messages(conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;
