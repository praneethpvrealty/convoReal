ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS calendar_archived_view TEXT NOT NULL DEFAULT 'greyed'
  CONSTRAINT profiles_calendar_archived_view_check
  CHECK (calendar_archived_view IN ('greyed', 'hidden', 'listed'));
