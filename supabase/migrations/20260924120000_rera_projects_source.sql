-- ============================================================
-- rera_projects.source — where a registry row came from.
--
--   'rera'    imported from the RERA portal; the only rows whose
--             rera_registration_number may be trusted
--   'curated' the hand-maintained seed list in /api/projects/sync
--   'ai'      suggested by Gemini from memory; unverified, and never
--             carries a registration number
--
-- Nullable so rows written before this column existed stay valid until
-- the backfill in 20260924120100 classifies them.
-- ============================================================

ALTER TABLE rera_projects ADD COLUMN IF NOT EXISTS source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rera_projects_source_check'
  ) THEN
    ALTER TABLE rera_projects
      ADD CONSTRAINT rera_projects_source_check
      CHECK (source IS NULL OR source IN ('rera', 'curated', 'ai'));
  END IF;
END $$;
