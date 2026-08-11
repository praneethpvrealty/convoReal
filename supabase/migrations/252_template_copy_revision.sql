-- ============================================================
-- 252_template_copy_revision.sql
-- Which shipped wording a row started from.
--
-- Two facts about a template row look identical from outside: its
-- body differs from the copy ConvoReal ships. That happens for
-- opposite reasons —
--
--   the ACCOUNT reworded it  → theirs, never overwrite
--   the SHIPPED copy moved   → ours improved, worth offering
--
-- and the correct response is the reverse in each case. With no way
-- to tell them apart, the only safe action is none, which means a
-- native speaker's correction lands in template-copy.ts and reaches
-- nobody who already created the template.
--
-- One column fixes it. Stamped on creation with a fingerprint of the
-- copy the row was built from, then compared two ways at read time
-- (see src/lib/whatsapp/template-drift.ts):
--
--   body still matches the stamp   → they never touched it
--   stamp is the current revision  → shipped copy has not moved
--
-- Deliberately NULL-able and not backfilled. For a row that predates
-- this migration, "did they edit it?" is genuinely unanswerable, and
-- guessing is how you overwrite somebody's wording. NULL resolves to
-- "customised", which is the reading that never destroys anything,
-- and it disappears on its own because every write path stamps it.
-- ============================================================

ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS copy_revision TEXT;

COMMENT ON COLUMN message_templates.copy_revision IS
  'Fingerprint of the shipped copy this row was created from (revisionOf() in src/lib/whatsapp/template-copy.ts). Distinguishes an account edit from a shipped-copy improvement. NULL on pre-252 rows, which read as customised.';

-- The template list resolves drift for every visible row on render.
-- Cheap either way at current volumes, but the column belongs in the
-- index that already serves that lookup rather than sending the
-- planner back to the heap for one string.
CREATE INDEX IF NOT EXISTS message_templates_account_name_language_idx
  ON message_templates (account_id, name, language) INCLUDE (copy_revision);
