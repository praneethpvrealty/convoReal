-- ============================================================
-- Quick-reply buttons ("Fine 👍" / "Requesting reschedule") on all
-- four appointment-reminder templates, plus the plumbing to notice
-- when a client taps "Requesting reschedule":
--
--   1. appointment_reminder_log.wa_message_id records the outbound
--      reminder's Meta message id, so the webhook can match an
--      inbound button-tap reply (message.context.id) back to the
--      appointment it was about.
--   2. appointments.reschedule_requested_at is stamped when a client
--      taps "Requesting reschedule" — surfaced as a Calendar badge
--      and used to notify the assigned agent. Cleared automatically
--      when the appointment is actually rescheduled to a new time
--      (src/app/(dashboard)/calendar/page.tsx,
--      src/app/api/appointments/[id]/route.ts) — the request is
--      resolved by definition once the time changes.
--
-- Buttons only apply to templates that haven't reached Meta yet
-- (meta_template_id IS NULL) — an already-submitted/approved template
-- can't have its button set silently rewritten locally without
-- actually resubmitting, so a genuinely-approved row (real
-- meta_template_id) is left untouched.
--
-- Note this also corrects property_visit_reminder's phantom
-- 'APPROVED' status from migration 045: it was seeded APPROVED
-- without ever being submitted to Meta (meta_template_id is null), so
-- it resets to DRAFT here too — a real resubmission (now with the two
-- buttons) is required regardless of the wording change.
-- ============================================================

UPDATE message_templates
SET
  buttons = '[{"type":"QUICK_REPLY","text":"Fine 👍"},{"type":"QUICK_REPLY","text":"Requesting reschedule"}]'::jsonb,
  status = CASE WHEN status = 'APPROVED' THEN 'DRAFT' ELSE status END,
  submission_error = NULL
WHERE name IN (
  'property_visit_reminder',
  'property_visit_reminder_agenda',
  'appointment_reminder',
  'appointment_reminder_agenda'
)
AND meta_template_id IS NULL;

ALTER TABLE appointment_reminder_log
  ADD COLUMN IF NOT EXISTS wa_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_appointment_reminder_log_wa_message_id
  ON appointment_reminder_log (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reschedule_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN appointment_reminder_log.wa_message_id IS
  'Meta message id of the outbound reminder send — matched against an inbound button-tap reply''s context.id to identify which appointment a "Requesting reschedule" tap was about.';
COMMENT ON COLUMN appointments.reschedule_requested_at IS
  'Set when a client taps "Requesting reschedule" on a reminder. Surfaced as a Calendar badge and triggers a WhatsApp notification to the assigned agent. Cleared when the appointment is moved to a new time.';
