-- ============================================================
-- 20261001043000_property_share_feedback_message_id.sql
-- Ties a property-share feedback request to the WhatsApp message
-- that carried it, so a tap on that message resolves to exactly
-- the share it asked about.
-- ============================================================

ALTER TABLE property_shares
  ADD COLUMN IF NOT EXISTS feedback_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_property_shares_feedback_message
  ON property_shares(account_id, feedback_message_id)
  WHERE feedback_message_id IS NOT NULL;
