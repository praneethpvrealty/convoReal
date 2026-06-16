-- Add source column to contacts table to track contact origin
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT NULL;

-- Create index on source for quick filtering/searching
CREATE INDEX IF NOT EXISTS idx_contacts_source ON contacts(source);
