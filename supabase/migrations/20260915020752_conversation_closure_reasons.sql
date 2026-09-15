ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS close_note TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_close_reason_check CHECK (
    close_reason IS NULL OR close_reason IN (
      'requirement_unmatched',
      'not_responding',
      'requirement_on_hold',
      'budget_or_location_changed',
      'completed_elsewhere',
      'enquiry_resolved',
      'duplicate_or_invalid',
      'other'
    )
  ),
  ADD CONSTRAINT conversations_close_note_length_check CHECK (
    close_note IS NULL OR char_length(close_note) <= 500
  ),
  ADD CONSTRAINT conversations_other_close_note_check CHECK (
    close_reason IS DISTINCT FROM 'other' OR NULLIF(btrim(close_note), '') IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS conversations_active_closed_reason_idx
  ON public.conversations (account_id, close_reason)
  WHERE status = 'closed' AND is_archived = false;
