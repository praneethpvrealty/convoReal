-- Add todo/completion fields to contact_notes so agents can check notes
-- off like a todo list, and track when notes were last edited.

ALTER TABLE contact_notes
  ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Keep updated_at in sync on every update
CREATE OR REPLACE FUNCTION set_contact_notes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_notes_updated_at ON contact_notes;
CREATE TRIGGER contact_notes_updated_at
  BEFORE UPDATE ON contact_notes
  FOR EACH ROW EXECUTE FUNCTION set_contact_notes_updated_at();
