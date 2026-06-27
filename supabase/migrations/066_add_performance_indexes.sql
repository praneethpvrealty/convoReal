-- Migration 066: Add Performance Indexes for Contacts and Properties
-- Speeds up search, filter, and sort queries to keep API latencies well under 1s.

CREATE INDEX IF NOT EXISTS idx_properties_account_published_status_created
  ON properties (account_id, is_published, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_account_status_classification
  ON contacts (account_id, status, classification);

CREATE INDEX IF NOT EXISTS idx_contact_tags_ids
  ON contact_tags (contact_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_contact_notes_contact_account
  ON contact_notes (contact_id, account_id);
