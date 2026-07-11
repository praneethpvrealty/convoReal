-- Add strict_area_match column to contacts table
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS strict_area_match BOOLEAN DEFAULT false;
