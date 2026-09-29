-- A delivery claim records the appointment's reminders_rearmed_at as
-- the claiming sweep read it. A later sweep that finds the claim in
-- place compares generations rather than clocks: a claim a stale
-- sweep inserted after a re-arm carries the old generation and is
-- taken over, never mistaken for coverage
-- (src/lib/appointments/reminder.ts).

ALTER TABLE appointment_reminder_log
  ADD COLUMN IF NOT EXISTS rearmed_at TIMESTAMPTZ;

COMMENT ON COLUMN appointment_reminder_log.rearmed_at IS
  'appointments.reminders_rearmed_at as the sweep that made this claim read it; a claim from another generation is superseded.';
