-- ============================================================
-- 168 — unblock auth.users deletion for self-service account
--       deletion (App Store Guideline 5.1.1(v)).
--
-- Two columns reference auth.users in a way that makes deleting a
-- user impossible:
--
--   contact_merge_log.merged_by  — NOT NULL with no ON DELETE
--     action, so the default NO ACTION raises a FK violation.
--   marketplace_items.created_by — NOT NULL with ON DELETE SET
--     NULL, a contradiction: the cascade fires and then trips the
--     NOT NULL constraint.
--
-- Both are provenance columns; losing the author on a deleted user
-- is the intended outcome, so drop NOT NULL and settle both on
-- ON DELETE SET NULL.
-- ============================================================

ALTER TABLE contact_merge_log
  ALTER COLUMN merged_by DROP NOT NULL;

ALTER TABLE contact_merge_log
  DROP CONSTRAINT IF EXISTS contact_merge_log_merged_by_fkey;

ALTER TABLE contact_merge_log
  ADD CONSTRAINT contact_merge_log_merged_by_fkey
  FOREIGN KEY (merged_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE marketplace_items
  ALTER COLUMN created_by DROP NOT NULL;
