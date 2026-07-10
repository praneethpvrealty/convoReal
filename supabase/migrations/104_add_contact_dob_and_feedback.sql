-- ============================================================
-- 104_add_contact_dob_and_feedback.sql — Add DOB and feedback status to contacts
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS dob DATE,
  ADD COLUMN IF NOT EXISTS feedback_status TEXT NOT NULL DEFAULT 'not_requested'
  CONSTRAINT contacts_feedback_status_check CHECK (feedback_status IN ('not_requested', 'requested', 'collected'));

-- Index on dob for birthdays
CREATE INDEX IF NOT EXISTS idx_contacts_dob ON public.contacts(dob);
