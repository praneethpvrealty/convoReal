-- ============================================================
-- 285_journey_stage_kind.sql — which journey stages mean the deal is
-- already in flight.
--
-- The follow-up radar cards a HOT lead who has gone quiet on WhatsApp
-- (migration 272). A buyer at "Token & Legal" or "Registration" is
-- quiet precisely BECAUSE the work moved to lawyers, banks and the
-- sub-registrar — so the radar's signal inverts exactly where the
-- stakes are highest. Two live buyers a week from registration were
-- carded as "quiet for 28 days", and the check-in that fires from that
-- card (enquiry_checkin_notice) tells the lead their enquiry is still
-- open and offers "Close my enquiry" — which marks the contact dead.
--
-- stage_kind is the account's own answer to "is this relationship past
-- the enquiry?". It has to be a column and not a position rule: stages
-- are customisable, so the fifth stage means nothing on its own.
-- Seeded to match DEFAULT_JOURNEY_STAGES and editable from the stage
-- editor.
--
--   prospecting — still being worked as an enquiry (radar applies)
--   closing     — token paid, legal/registration under way
--   won         — the deal completed
--   lost        — the deal died
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE journey_stages
  ADD COLUMN IF NOT EXISTS stage_kind TEXT NOT NULL DEFAULT 'prospecting'
  CHECK (stage_kind IN ('prospecting', 'closing', 'won', 'lost'));

-- Accounts seeded before this column existed carry the default stage
-- names. Matched by name rather than position so a reordered board is
-- left alone rather than mislabelled.
UPDATE journey_stages
  SET stage_kind = 'closing'
  WHERE stage_kind = 'prospecting'
    AND name IN ('Token & Legal', 'Registration');

UPDATE journey_stages
  SET stage_kind = 'won'
  WHERE stage_kind = 'prospecting'
    AND name = 'Brokerage Paid';

CREATE INDEX IF NOT EXISTS idx_journey_stages_kind
  ON journey_stages (account_id, stage_kind);
