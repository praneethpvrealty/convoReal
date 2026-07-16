-- ============================================================
-- Agenda-carrying variant of the client visit reminder template.
--
-- The original property_visit_reminder has a fixed 5-placeholder
-- body, so the new appointment agenda field can't ride on it.
-- This seeds a 6-placeholder variant ({{5}} = agenda) for every
-- account as DRAFT. Meta must approve it per WABA before it can
-- be sent: submit it from Settings → Templates (it appears there
-- ready to submit). Until a given account's copy is APPROVED, the
-- reminder cron keeps using the original template for that
-- account — no reminder is ever blocked on approval.
-- ============================================================

INSERT INTO message_templates (user_id, account_id, name, category, language, body_text, sample_values, status)
SELECT
  a.owner_user_id,
  a.id AS account_id,
  'property_visit_reminder_agenda' AS name,
  'Utility' AS category,
  'en_US' AS language,
  'Hi {{1}}, this is a friendly reminder for your scheduled property visit for "{{2}}" on {{3}}. Location: {{4}}. Agenda: {{5}}. Regards, {{6}}.' AS body_text,
  '{"body": ["Rahul", "3BHK in JP Nagar", "16/07/2026, 5:30 pm", "JP Nagar 5th Phase", "Final pricing and loan options", "PV Realty"]}'::jsonb AS sample_values,
  'DRAFT' AS status
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM message_templates t
  WHERE t.account_id = a.id AND t.name = 'property_visit_reminder_agenda'
);
