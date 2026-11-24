-- ============================================================
-- 20261124101500_appointments_deal_link.sql
--
-- A calendar event can belong to a deal. The link is one nullable
-- column: an event belongs to at most one deal, a deal has many
-- events, and deleting the deal leaves the event on the calendar.
--
-- Purely additive: a nullable column and a partial index.
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_deal
  ON appointments (deal_id)
  WHERE deal_id IS NOT NULL;

COMMENT ON COLUMN appointments.deal_id IS
  'The deal this event belongs to, when the agent connected one (CAL-022).';
