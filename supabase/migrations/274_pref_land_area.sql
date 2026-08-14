-- ============================================================
-- 274_pref_land_area.sql — plot/built-up size as a matching facet.
--
-- A buyer answered a 4,200 sq.ft. shortlist with "Looking for lesser
-- dimensions" and the matcher had nowhere to put it: size was not a
-- preference it knew, so re-ranking returned the identical plot.
-- Two columns, in canonical square feet like every other area figure
-- the engine derives (see toSquareFeet in
-- src/lib/ai/listing-derivations.ts), written by the preference
-- extraction and the ladder's smaller/bigger anchoring, read by
-- src/lib/matching.ts.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pref_land_area_min_sqft NUMERIC,
  ADD COLUMN IF NOT EXISTS pref_land_area_max_sqft NUMERIC;
