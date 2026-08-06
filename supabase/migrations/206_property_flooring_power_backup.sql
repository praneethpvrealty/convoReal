-- ============================================================
-- 206_property_flooring_power_backup.sql
-- Two more unit details the listing portals ask for on their
-- amenities step and the Engine didn't model: flooring type and
-- power backup. The portal post kit sends these real values
-- instead of leaving the chips for the agent to click by hand.
-- ============================================================

ALTER TABLE properties ADD COLUMN IF NOT EXISTS flooring TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS power_backup TEXT;
