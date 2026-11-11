-- Portfolio value: what an owner's properties are worth, from three
-- sources that are never blended into one invented number.
--
--   1. market_stats gains per-sq.ft price quantiles so a market range
--      can be worked out for one property from its anonymized cell.
--   2. owner_property_values holds the value an owner states for their
--      own property. It is the owner's private figure: RLS is on with
--      no policy, so it is read and written only by /api/den/value
--      under the caller's DenContext, never by a staff session.
--   3. den_users.referral_source records the partner link a new owner
--      signed up through.
--
-- Additive only: new nullable columns and one new table.

ALTER TABLE market_stats
  ADD COLUMN IF NOT EXISTS priced_count INT,
  ADD COLUMN IF NOT EXISTS median_price_per_sqft NUMERIC,
  ADD COLUMN IF NOT EXISTS p25_price_per_sqft NUMERIC,
  ADD COLUMN IF NOT EXISTS p75_price_per_sqft NUMERIC;

ALTER TABLE den_users
  ADD COLUMN IF NOT EXISTS referral_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'den_users_referral_source_format'
  ) THEN
    ALTER TABLE den_users
      ADD CONSTRAINT den_users_referral_source_format
      CHECK (
        referral_source IS NULL
        OR referral_source ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS owner_property_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  den_user_id UUID REFERENCES den_users(id) ON DELETE SET NULL,
  declared_value NUMERIC NOT NULL CHECK (declared_value > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_property_values_account
  ON owner_property_values (account_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at'
      AND tgrelid = 'owner_property_values'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at BEFORE UPDATE ON owner_property_values
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE owner_property_values ENABLE ROW LEVEL SECURITY;
