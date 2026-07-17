-- ============================================================
-- Fix three reminder templates that fail Meta's variable-density
-- check for Utility templates (enforced client-side in
-- src/lib/whatsapp/template-validators.ts, mirroring Meta's own
-- anti-abuse rule): a Utility template needs at least 3 static
-- (non-{{n}}) words per variable. Found trying to actually submit
-- them via the Submit button added for DRAFT templates:
--
--   property_visit_reminder_agenda (129): 6 vars, only 16 static
--     words (needs 18) — this one predates this session's work, so
--     it was never actually submittable either, just never noticed
--     since nothing offered a way to submit a DRAFT template until
--     the Submit-button fix.
--   appointment_reminder (140):           5 vars, only 13 static
--     words (needs 15).
--   appointment_reminder_agenda (140):    6 vars, only 14 static
--     words (needs 18).
--
-- property_visit_reminder (045) already has exactly 15 static words
-- for 5 variables and is left unchanged.
--
-- Only rewrites rows that haven't reached Meta yet (meta_template_id
-- IS NULL) — same safety rule as migrations 140/141.
-- ============================================================

UPDATE message_templates
SET body_text = 'Hi {{1}}, this is a friendly reminder that you have a scheduled property visit for "{{2}}" on {{3}}. Location: {{4}}. Agenda for the visit: {{5}}. Kind regards, {{6}}.'
WHERE name = 'property_visit_reminder_agenda'
  AND meta_template_id IS NULL;

UPDATE message_templates
SET body_text = 'Hi {{1}}, this is a friendly reminder that you have a scheduled meeting: "{{2}}" on {{3}}. Location: {{4}}. Kind regards, {{5}}.'
WHERE name = 'appointment_reminder'
  AND meta_template_id IS NULL;

UPDATE message_templates
SET body_text = 'Hi {{1}}, this is a friendly reminder that you have a scheduled meeting: "{{2}}" on {{3}}. Location: {{4}}. Agenda for the meeting: {{5}}. Kind regards, {{6}}.'
WHERE name = 'appointment_reminder_agenda'
  AND meta_template_id IS NULL;
