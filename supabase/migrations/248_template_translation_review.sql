-- Native-speaker sign-off on a translated template, before Meta sees it.
--
-- The Indic copy in src/lib/whatsapp/template-copy.ts was written by a
-- machine. It goes out under a brokerage's own name to their own
-- buyers, and a Meta rejection reserves the template name for four
-- weeks (AGENTS.md §2.7) — so "submit and see" is an expensive way to
-- find out the Malayalam reads badly.
--
-- Hence: a non-English variant of an Engine template is created as a
-- local DRAFT, someone who reads the language checks it (and edits it
-- if needed), and only then can it be submitted. English is exempt —
-- it is the source copy and has always been submittable in one tap.
--
-- Per row rather than per (name, language) globally, because each
-- account may reword the copy for its own market and is signing off on
-- what IT will send, not on what ConvoReal shipped.

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS translation_reviewed_at TIMESTAMPTZ;
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS translation_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Editing the body after sign-off invalidates it: the reviewer approved
-- the words that were there, not whatever replaced them. Cheaper and
-- far harder to forget than asking every write path to remember.
CREATE OR REPLACE FUNCTION public.reset_translation_review()
RETURNS TRIGGER
LANGUAGE plpgsql
-- See the note on enforce_active_ui_language in 247: same reason,
-- same lint (0011_function_search_path_mutable).
SET search_path = public
AS $$
BEGIN
  IF NEW.body_text IS DISTINCT FROM OLD.body_text
     OR NEW.footer_text IS DISTINCT FROM OLD.footer_text
     OR NEW.buttons IS DISTINCT FROM OLD.buttons THEN
    -- Only clear a sign-off the caller is not itself making. Without
    -- this, a review that lands in the same UPDATE as an edit (the
    -- "fix the wording and approve it" case) would erase itself.
    IF NEW.translation_reviewed_at IS NOT DISTINCT FROM OLD.translation_reviewed_at THEN
      NEW.translation_reviewed_at := NULL;
      NEW.translation_reviewed_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS message_templates_reset_translation_review ON message_templates;
CREATE TRIGGER message_templates_reset_translation_review
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION public.reset_translation_review();

COMMENT ON COLUMN message_templates.translation_reviewed_at IS
  'When someone who reads this language signed the copy off. NULL blocks submission of a non-English Engine template. Cleared automatically when the copy changes.';
COMMENT ON COLUMN message_templates.translation_reviewed_by IS
  'auth.users.id of the reviewer, for the audit trail.';
