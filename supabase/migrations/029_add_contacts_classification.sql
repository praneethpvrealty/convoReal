-- ============================================================
-- 029_add_contacts_classification.sql — Add classification to contacts
-- ============================================================

-- 1. Add classification column to contacts table with constraints
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'Others' 
  CHECK (classification IN ('Owner', 'Seller', 'Buyer', 'Agent', 'Others'));
