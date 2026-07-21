-- ============================================================
-- Named-project watchlist on contacts.
--
-- Buyers frequently name SPECIFIC projects/societies they want
-- (e.g. "Purva Vantage, DSR Rainbow Heights, Meenakshi Classic"),
-- which is stronger intent than a locality. The Gemini preference
-- extraction (092) now pulls these named projects — distinct from
-- localities (pref_areas) and property types — into pref_projects.
-- The matching engine (src/lib/matching.ts) treats a property whose
-- `project`/title matches one of these as a strong, decisive signal
-- so the buyer surfaces the moment matching inventory is listed.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pref_projects TEXT[];

COMMENT ON COLUMN contacts.pref_projects IS
  'AI-extracted named projects/societies the buyer is interested in (e.g. "Purva Vantage"). Distinct from pref_areas (localities). Matched against properties.project/title in src/lib/matching.ts.';
