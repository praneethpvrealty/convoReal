-- Whether the member who created an appointment gets its agent-side
-- reminders (the pre-event brief, the morning digest entry and the
-- overdue nudge) alongside the member it is assigned to. On by default
-- so every existing and new event keeps reminding its creator; the
-- create and edit forms on web and mobile let the creator turn it off.
--
-- Purely additive: a new nullable-free column with a default.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS remind_creator BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.appointments.remind_creator IS
  'Send the creator (user_id) the agent reminders for this event, in addition to the assignee. Default true.';
