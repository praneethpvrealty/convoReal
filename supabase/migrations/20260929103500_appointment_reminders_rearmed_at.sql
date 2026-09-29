-- Reopening or moving an appointment re-arms its client reminders.
-- Resetting reminder_morning_sent / reminder_1h_sent alone is not
-- enough: every send first claims an (appointment, recipient, type)
-- row in appointment_reminder_log, and a claim left from the earlier
-- send would make the cron mark the reminder covered without sending.
-- The re-arm instant is stamped in the same UPDATE as the flags, so a
-- failed write leaves the earlier reminder state whole; the cron treats
-- a claim made before it as superseded and takes it over, and a voice
-- note still queued under the old claim is dropped
-- (src/lib/appointments/reminder.ts, src/lib/voice/reminder-audio-worker.ts).

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminders_rearmed_at TIMESTAMPTZ;

COMMENT ON COLUMN appointments.reminders_rearmed_at IS
  'When the client reminders were last re-armed (reopened or rescheduled through PUT /api/appointments/[id]). A delivery claim in appointment_reminder_log made before this instant is superseded.';
