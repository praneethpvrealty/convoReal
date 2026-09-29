-- A delivery claim is provisional until its send is confirmed. The
-- cron and the voice-note worker stamp sent_at once the message has
-- gone; a claim of the current generation whose send was never
-- confirmed — a worker that died mid-send, a release that failed — is
-- taken over by the cron after a grace period instead of counting as
-- coverage forever (src/lib/appointments/reminder.ts).

ALTER TABLE appointment_reminder_log
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

COMMENT ON COLUMN appointment_reminder_log.sent_at IS
  'When the reminder this claim covers was confirmed sent; null while the send is still in flight. An old unconfirmed claim is retried by the cron.';
