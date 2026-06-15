-- ============================================================
-- 039_add_property_to_deals.sql — Link deals to properties in inventory
-- ============================================================

ALTER TABLE deals 
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_property ON deals(property_id);
