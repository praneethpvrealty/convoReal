CREATE INDEX IF NOT EXISTS idx_property_shares_contact
  ON property_shares(account_id, contact_id, created_at DESC);
