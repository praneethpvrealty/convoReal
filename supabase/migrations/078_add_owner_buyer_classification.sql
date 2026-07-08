-- Add 'Owner & Buyer' classification for contacts who own properties
-- in our listings AND are also looking to buy or invest.

-- Drop the old constraint and add a new one with the expanded set
ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_classification_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_classification_check
  CHECK (classification IN ('Owner', 'Seller', 'Buyer', 'Agent', 'Developer', 'Owner & Buyer', 'Others'));
