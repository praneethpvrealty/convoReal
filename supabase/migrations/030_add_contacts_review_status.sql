-- Add review status to contacts table
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' 
  CHECK (status IN ('active', 'pending_review'));

CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
