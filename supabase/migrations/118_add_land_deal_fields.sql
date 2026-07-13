-- ============================================================
-- 118_add_land_deal_fields.sql
--
-- Land/JV deal notes used to prefill the "Share via Email" property
-- draft (src/lib/email/property-share-email.ts) with the same structure
-- agents already use when emailing land opportunities by hand:
-- ownership status, land use/zoning breakdown, and freeform deal remarks
-- (legal status, aggregation timeline, road access, etc).
--
-- Internal/agent-facing only — never exposed on the public showcase or
-- public APIs.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS ownership_status TEXT,
  ADD COLUMN IF NOT EXISTS land_use_zoning TEXT,
  ADD COLUMN IF NOT EXISTS deal_remarks TEXT;

COMMENT ON COLUMN properties.ownership_status IS
  'Freeform ownership status for land/JV deals, e.g. "Multiple owners, aggregation in process" or "Single owner". Internal only.';
COMMENT ON COLUMN properties.land_use_zoning IS
  'Freeform land use / zoning breakdown, e.g. "Residential zone 26A 13G, Red Zone 5A 29G". Internal only.';
COMMENT ON COLUMN properties.deal_remarks IS
  'Freeform deal remarks — legal status, aggregation timeline, road access, etc. Internal only.';
