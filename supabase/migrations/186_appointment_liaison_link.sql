-- ============================================================
-- 186: appointments.liaison_id — the service provider on an event.
--
-- A meeting is often WITH a lawyer, surveyor, khata agent or CA rather
-- than with a buyer or owner. Those people live in the liaisons
-- directory (147_liaisons.sql), not in contacts, so resolving the name
-- against contacts alone found nothing and the event was left attached
-- to nobody — no link, no record of who it was with.
--
-- Nullable and ON DELETE SET NULL: retiring a liaison must not take
-- calendar history with it. Kept separate from contact_id/contact_ids
-- because a liaison is not a lead: they are deliberately outside the
-- client reminder path, which drives off contact_ids.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS liaison_id UUID REFERENCES liaisons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_liaison
  ON appointments(liaison_id)
  WHERE liaison_id IS NOT NULL;

COMMENT ON COLUMN appointments.liaison_id IS
  'Service provider (lawyer, surveyor, khata agent) this event is with. Separate from contact_ids so liaisons stay out of the client reminder path.';
