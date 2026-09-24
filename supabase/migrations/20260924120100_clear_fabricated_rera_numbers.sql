-- ============================================================
-- Clear every RERA registration number that was never sourced from
-- RERA.
--
-- Nothing has ever imported from the RERA portal. Every existing row
-- came from one of two places, and both invented the number:
--   * the seed list in /api/projects/sync, which stamped
--     `<prefix><200000 + idx*7>` onto each curated project
--   * Gemini, prompted for an "actual or mock" number, either on a
--     project search miss or during the sync's expansion step
-- Some model-made numbers were even handed to two different projects.
--
-- Seed rows are recognised by the exact shape the seed generator
-- produced; everything else is AI output.
-- ============================================================

UPDATE rera_projects
SET source = CASE
      WHEN rera_registration_number ~ '^PRM/KA/RERA/125[01]/(446|309|303|310|301)/PR/2[0-9]{5}$'
        THEN 'curated'
      ELSE 'ai'
    END
WHERE source IS NULL;

UPDATE rera_projects
SET rera_registration_number = NULL,
    updated_at = NOW()
WHERE source IN ('curated', 'ai')
  AND rera_registration_number IS NOT NULL;
