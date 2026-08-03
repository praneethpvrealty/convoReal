-- ============================================================
-- 187_drop_crm_vocabulary_from_column_comments.sql
--
-- "CRM" was retired from the product vocabulary in favour of the
-- ConvoReal Engine. Three column comments are live database
-- metadata rather than repo text, so editing the migrations that
-- created them (064, 130, 150) only fixes a freshly-built database
-- — an already-migrated one keeps the old string until it is
-- re-stated here.
--
-- Those source migrations were updated in the same change, so a
-- fresh chain produces the new text directly and this file is a
-- harmless no-op for it.
--
-- Comments only. No schema, data, policy or grant changes.
-- Idempotent — COMMENT ON is a straight overwrite.
-- ============================================================

COMMENT ON COLUMN properties.notes IS
  'Internal agent notes about the property — visible only in the Engine, never on the public portal. Useful for location landmarks, access instructions, owner details, etc.';

COMMENT ON COLUMN properties.floor_tenancies IS
  'Floor-wise rent roll for pre-leased commercial buildings: tenant, monthly rent (excluding GST), lease window, lock-in, maintenance per floor. Engine-only.';

COMMENT ON COLUMN contacts.pref_suggested_tags IS
  'AI-suggested Engine tag labels extracted from requirements/notes free text. Display-only until an agent confirms one (which creates/attaches a real tags/contact_tags row).';
