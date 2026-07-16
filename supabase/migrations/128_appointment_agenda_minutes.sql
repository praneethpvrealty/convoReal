-- ============================================================
-- Structured pre/post-event notes on appointments, shown per
-- event type in the UI (config lives in
-- src/components/calendar/event-types.ts):
--
--   agenda  — pre-event: talking points / things to prepare.
--             Meetings, calls, follow-ups, document work.
--             Included in the assignee's 1h WhatsApp brief.
--   minutes — post-event: minutes of the meeting / call notes.
--             Meetings and calls.
--   outcome — post-event: result / feedback / next step.
--             Site visits, follow-ups, document work.
--
-- Client-facing template reminders can't carry these (fixed
-- placeholder count on the approved Meta template); the agenda
-- rides along on the free-form agent brief instead.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS agenda TEXT,
  ADD COLUMN IF NOT EXISTS minutes TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT;

COMMENT ON COLUMN appointments.agenda IS
  'Pre-event agenda / preparation notes. Shown for meetings, calls, follow-ups, and document work; sent in the assignee''s pre-event WhatsApp brief.';
COMMENT ON COLUMN appointments.minutes IS
  'Post-event minutes of the meeting / call notes. Shown for meetings and calls.';
COMMENT ON COLUMN appointments.outcome IS
  'Post-event outcome — visit feedback, follow-up result, or document status. Shown for site visits, follow-ups, and document work.';
