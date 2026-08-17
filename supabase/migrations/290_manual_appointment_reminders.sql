ALTER TABLE appointment_reminder_log
  DROP CONSTRAINT IF EXISTS appointment_reminder_log_reminder_type_check;

ALTER TABLE appointment_reminder_log
  ADD CONSTRAINT appointment_reminder_log_reminder_type_check
  CHECK (reminder_type IN ('morning', '1h', 'manual'));

COMMENT ON COLUMN appointment_reminder_log.reminder_type IS
  'Reminder delivery source: morning cron, one-hour cron, or a manual send from an agent reminder action.';
