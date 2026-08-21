-- ============================================================
-- 20260821130000_property_share_feedback.sql
-- Add feedback loop tracking to property shares.
-- ============================================================

ALTER TABLE property_shares
  ADD COLUMN IF NOT EXISTS feedback_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (feedback_status IN ('pending', 'sent', 'skipped')),
  ADD COLUMN IF NOT EXISTS feedback_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_property_shares_feedback
  ON property_shares(feedback_status, created_at)
  WHERE feedback_status = 'pending';
