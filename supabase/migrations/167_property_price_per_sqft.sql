-- ============================================================
-- 167_property_price_per_sqft.sql
-- Rate quoted per Sq.Ft. during intake ("Price - 10500 per sqft").
-- `price` is derived from it once an area is known; keeping the rate
-- itself preserves what the owner actually quoted after the draft
-- session is cleared on confirm.
-- ============================================================

ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_per_sqft NUMERIC;
