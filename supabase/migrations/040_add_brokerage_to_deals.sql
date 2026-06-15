-- 040_add_brokerage_to_deals.sql — Add brokerage columns to deals table

ALTER TABLE deals 
  ADD COLUMN IF NOT EXISTS brokerage_type TEXT CHECK (brokerage_type IN ('percentage', 'fixed')) DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS brokerage_value NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS brokerage_amount NUMERIC(12,2) DEFAULT 0;
