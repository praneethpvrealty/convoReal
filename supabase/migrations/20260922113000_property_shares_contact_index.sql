-- The share ledger is read by contact on every inbound question: once to
-- decide whether a funnel keyword may open the welcome menu, and again by
-- resolvePropertySubject to find the listing the question is about. Both
-- filter on (account_id, contact_id) and take the newest row, which until
-- now had no index to lean on.

CREATE INDEX IF NOT EXISTS idx_property_shares_contact
  ON property_shares(account_id, contact_id, created_at DESC);
