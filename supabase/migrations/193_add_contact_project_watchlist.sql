-- ============================================================
-- Agent-entered project watchlist on contacts.
--
-- pref_projects (156) is AI-extracted and is rewritten wholesale
-- whenever the requirements text changes, so it cannot hold a project
-- an agent typed in. projects_of_interest is the explicit twin — the
-- same split areas_of_interest/pref_areas already uses — and
-- src/lib/matching.ts matches the union of the two.
--
-- strict_project_match turns that union from a boost into a gate: a
-- buyer who wants one named project and nothing else stops receiving
-- every other listing that merely fits their type, area and budget.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS projects_of_interest TEXT[],
  ADD COLUMN IF NOT EXISTS strict_project_match BOOLEAN DEFAULT false;

COMMENT ON COLUMN contacts.projects_of_interest IS
  'Agent-entered named projects/societies the contact wants (e.g. "Purva Westend"). Explicit twin of the AI-extracted pref_projects; src/lib/matching.ts matches the union of both against properties.project/title.';

COMMENT ON COLUMN contacts.strict_project_match IS
  'When true, only listings in projects_of_interest/pref_projects can match this contact — everything else is excluded regardless of type, area or budget fit.';
