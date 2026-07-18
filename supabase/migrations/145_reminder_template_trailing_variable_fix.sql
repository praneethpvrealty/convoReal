-- ============================================================
-- Fix all four appointment-reminder templates rejected by Meta's
-- leading/trailing-parameter rule. Found submitting
-- appointment_reminder_agenda after migration 144:
--
--   "Invalid parameter: Variables can't be at the start or end of
--    the template. (Leading or trailing params not allowed)"
--
-- Every variant ends with "Regards, {{5}}." / "Kind regards, {{6}}."
-- — Meta ignores trailing punctuation when applying this rule, so a
-- variable followed only by a period still counts as a trailing
-- param. (The client-side mirror of this rule now lives in
-- src/lib/whatsapp/template-validators.ts.)
--
-- Fix: move the sender name INTO the sentence ("a friendly reminder
-- from {{n}}") and end on a static call-to-action that also points at
-- the two quick-reply buttons added in migration 141. Variable count
-- and positional semantics are unchanged — the last placeholder is
-- still the account name — so reminder.ts keeps sending the exact
-- same param arrays. Static-word density stays above the 3-words-per-
-- variable Utility floor from migration 143 (26 static words for 5
-- vars; 30 for 6).
--
-- Also seeds sample_values for property_visit_reminder (seeded by 045
-- without any) — the submit flow requires exactly one sample per
-- variable, so without this the row can't be submitted as-is.
--
-- Only rewrites rows that haven't reached Meta yet (meta_template_id
-- IS NULL) — same safety rule as migrations 140/141/143/144 — and
-- clears submission_error so fixed rows stop showing the stale Meta
-- rejection.
-- ============================================================

UPDATE message_templates
SET
  body_text = 'Hi {{1}}, this is a friendly reminder from {{5}} about your scheduled property visit for "{{2}}" on {{3}}. Location: {{4}}. Please tap a button below to confirm or request a change.',
  sample_values = COALESCE(
    sample_values,
    '{"body": ["Rahul", "3BHK in JP Nagar", "16/07/2026, 5:30 pm", "JP Nagar 5th Phase", "PV Realty"]}'::jsonb
  ),
  submission_error = NULL
WHERE name = 'property_visit_reminder'
  AND meta_template_id IS NULL;

UPDATE message_templates
SET
  body_text = 'Hi {{1}}, this is a friendly reminder from {{6}} that you have a scheduled property visit for "{{2}}" on {{3}}. Location: {{4}}. Agenda for the visit: {{5}}. Please tap a button below to confirm or request a change.',
  submission_error = NULL
WHERE name = 'property_visit_reminder_agenda'
  AND meta_template_id IS NULL;

UPDATE message_templates
SET
  body_text = 'Hi {{1}}, this is a friendly reminder from {{5}} that you have a scheduled meeting: "{{2}}" on {{3}}. Location: {{4}}. Please tap a button below to confirm or request a change.',
  submission_error = NULL
WHERE name = 'appointment_reminder'
  AND meta_template_id IS NULL;

UPDATE message_templates
SET
  body_text = 'Hi {{1}}, this is a friendly reminder from {{6}} that you have a scheduled meeting: "{{2}}" on {{3}}. Location: {{4}}. Agenda for the meeting: {{5}}. Please tap a button below to confirm or request a change.',
  submission_error = NULL
WHERE name = 'appointment_reminder_agenda'
  AND meta_template_id IS NULL;
