-- ============================================================
-- Meta rejects WhatsApp quick-reply button text containing emoji,
-- newlines, or other formatting characters ("Invalid parameter:
-- Buttons can't have any variables, newlines, emojis or formatting
-- characters") — found submitting appointment_reminder_agenda, whose
-- "Fine 👍" button (migration 141) has an emoji. "Requesting
-- reschedule" was already plain text and is unaffected.
--
-- Only rewrites rows that haven't reached Meta yet (meta_template_id
-- IS NULL) — same safety rule as migrations 140/141/143. Also clears
-- submission_error so a fixed row doesn't keep showing the stale
-- rejection message from the earlier failed attempt.
-- ============================================================

UPDATE message_templates
SET
  buttons = '[{"type":"QUICK_REPLY","text":"Fine"},{"type":"QUICK_REPLY","text":"Requesting reschedule"}]'::jsonb,
  submission_error = NULL
WHERE name IN (
  'property_visit_reminder',
  'property_visit_reminder_agenda',
  'appointment_reminder',
  'appointment_reminder_agenda'
)
AND meta_template_id IS NULL;
