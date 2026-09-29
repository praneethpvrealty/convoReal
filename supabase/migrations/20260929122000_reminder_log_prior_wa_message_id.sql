-- A claim's send may be confirmed late — the confirmation rode the
-- queue through an outage — after the cron has already taken the claim
-- over and sent again. The unique (appointment, recipient, type) key
-- leaves one row for both sends, so the earlier message id is kept
-- beside the current one and the reply webhook matches a button tap by
-- either (src/lib/appointments/claim-confirm.ts,
-- src/lib/whatsapp/webhook-handler.ts).

ALTER TABLE appointment_reminder_log
  ADD COLUMN IF NOT EXISTS prior_wa_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_appointment_reminder_log_prior_wa_message_id
  ON appointment_reminder_log (prior_wa_message_id)
  WHERE prior_wa_message_id IS NOT NULL;

COMMENT ON COLUMN appointment_reminder_log.prior_wa_message_id IS
  'Message id of an earlier send of this claim whose confirmation arrived after the cron had taken the claim over; a button reply to it still maps to the appointment.';
