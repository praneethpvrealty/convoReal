-- ============================================================
-- 20260921100000_listing_feedback_dropoff_reasons.sql
--
-- Drop-off feedback: a lead who taps "Close my enquiry" is asked why
-- the shared property did not fit. Two answers a closing lead gives
-- that a shortlist rejection never does — they bought elsewhere, or
-- they are not buying right now — join the one-tap reason set.
-- Widening only: every existing row stays valid.
-- ============================================================

ALTER TABLE listing_feedback
  DROP CONSTRAINT IF EXISTS listing_feedback_reason_check;
ALTER TABLE listing_feedback
  ADD CONSTRAINT listing_feedback_reason_check
    CHECK (reason IN ('budget', 'location', 'type', 'size', 'bought_elsewhere', 'not_now', 'other'));
