-- Migration 048: Add Expected Min ROI to Contacts Table
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS min_roi NUMERIC CHECK (min_roi >= 0);

COMMENT ON COLUMN contacts.min_roi IS 'Minimum expected rental yield ROI (%) for buyer profiles.';
