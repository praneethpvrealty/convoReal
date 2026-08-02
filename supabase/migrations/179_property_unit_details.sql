-- ============================================================
-- 179_property_unit_details.sql
-- Unit details the listing portals mark mandatory but the Engine
-- didn't model: furnishing, floor number, total floors and
-- balconies. The portal post kit sends these real values instead
-- of review-and-fix defaults.
-- ============================================================

ALTER TABLE properties ADD COLUMN IF NOT EXISTS furnishing TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS floor_number INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS total_floors INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS balconies INTEGER;
