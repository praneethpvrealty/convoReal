-- ============================================================
-- 196_action_item_events_liaison_reminders.sql
-- Call-analysis action items become calendar events, and the
-- service provider on an event (lawyer, surveyor…) can opt into
-- the WhatsApp reminder path.
--
-- Liaisons stay out of contacts (migration 186's boundary holds):
-- the reminder cron sends to liaisons.phone via a raw template
-- send, tracked by liaison-keyed claim rows in the same
-- appointment_reminder_log. remind_liaison defaults FALSE so
-- existing events never start messaging their liaisons.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS remind_liaison BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN appointments.remind_liaison IS
  'Send the morning/1h WhatsApp reminders to the linked liaison as well. Opt-in per event; requires liaison_id and a valid liaisons.phone.';

-- Claim rows for liaison sends: contact_id becomes nullable and a
-- liaison_id alternative is added, with exactly one of the two set.
ALTER TABLE appointment_reminder_log
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE appointment_reminder_log
  ADD COLUMN IF NOT EXISTS liaison_id UUID REFERENCES liaisons(id) ON DELETE CASCADE;

ALTER TABLE appointment_reminder_log
  DROP CONSTRAINT IF EXISTS appointment_reminder_log_recipient_check;
ALTER TABLE appointment_reminder_log
  ADD CONSTRAINT appointment_reminder_log_recipient_check
  CHECK (
    (contact_id IS NOT NULL AND liaison_id IS NULL)
    OR (contact_id IS NULL AND liaison_id IS NOT NULL)
  );

-- The existing UNIQUE (appointment_id, contact_id, reminder_type)
-- ignores NULL contact_id rows, so liaison claims need their own
-- uniqueness for the cron's insert-to-claim race protection.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_log_liaison_claim
  ON appointment_reminder_log(appointment_id, liaison_id, reminder_type)
  WHERE liaison_id IS NOT NULL;

-- Stamp on the analyzed call once its action items have been turned
-- into events, so the UI offers the conversion exactly once.
ALTER TABLE contact_call_logs
  ADD COLUMN IF NOT EXISTS events_created_at TIMESTAMPTZ;
