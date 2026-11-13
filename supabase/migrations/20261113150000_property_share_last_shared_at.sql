ALTER TABLE property_shares
  ADD COLUMN IF NOT EXISTS last_shared_at TIMESTAMPTZ;

ALTER TABLE property_shares
  ALTER COLUMN last_shared_at SET DEFAULT NOW();

COMMENT ON COLUMN property_shares.last_shared_at IS
  'When this listing last went to this contact. Set on every send by the share ledger writers (the row itself is kept once per contact×property, so created_at is only the first send); NULL on rows written before it existed, where created_at stands in. Read by the 24-hour duplicate check (PRP-061).';
