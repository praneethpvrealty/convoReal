-- ============================================================
-- Generic (non-site-visit) appointment reminder templates.
--
-- The existing property_visit_reminder / property_visit_reminder_agenda
-- templates hard-code "your scheduled property visit" wording, which
-- reminder.ts sent for EVERY appointment regardless of event_type —
-- a meeting, call, follow-up, or document appointment got a reminder
-- that talked about a "property visit". These two templates carry
-- neutral wording for anything that isn't event_type = 'site_visit'.
--
-- Seeded as DRAFT for every account, same as 129's agenda variant:
-- Meta must approve each account's own copy before it can be sent.
-- Submit from Settings → Templates (appears there ready to submit).
-- Until a given account's copy is APPROVED, the reminder cron falls
-- back to skipping that reminder rather than sending unapproved
-- content — no reminder is ever blocked on approval for OTHER
-- accounts/templates.
-- ============================================================

INSERT INTO message_templates (user_id, account_id, name, category, language, body_text, sample_values, status)
SELECT
  a.owner_user_id,
  a.id AS account_id,
  'appointment_reminder' AS name,
  'Utility' AS category,
  'en_US' AS language,
  'Hi {{1}}, this is a friendly reminder for your scheduled meeting: "{{2}}" on {{3}}. Location: {{4}}. Regards, {{5}}.' AS body_text,
  '{"body": ["Rahul", "Loan discussion", "16/07/2026, 5:30 pm", "JP Nagar 5th Phase office", "PV Realty"]}'::jsonb AS sample_values,
  'DRAFT' AS status
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM message_templates t
  WHERE t.account_id = a.id AND t.name = 'appointment_reminder'
);

INSERT INTO message_templates (user_id, account_id, name, category, language, body_text, sample_values, status)
SELECT
  a.owner_user_id,
  a.id AS account_id,
  'appointment_reminder_agenda' AS name,
  'Utility' AS category,
  'en_US' AS language,
  'Hi {{1}}, this is a friendly reminder for your scheduled meeting: "{{2}}" on {{3}}. Location: {{4}}. Agenda: {{5}}. Regards, {{6}}.' AS body_text,
  '{"body": ["Rahul", "Loan discussion", "16/07/2026, 5:30 pm", "JP Nagar 5th Phase office", "Final pricing and loan options", "PV Realty"]}'::jsonb AS sample_values,
  'DRAFT' AS status
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM message_templates t
  WHERE t.account_id = a.id AND t.name = 'appointment_reminder_agenda'
);
