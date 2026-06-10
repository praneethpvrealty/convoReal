-- ============================================================
-- 021_real_estate_inventory.sql — Real Estate Inventory module
-- ============================================================

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL,
  location TEXT NOT NULL,
  type TEXT NOT NULL, -- e.g. Apartment, House, Villa, Land, Commercial
  status TEXT NOT NULL DEFAULT 'Available', -- e.g. Available, Under Contract, Sold, Off Market
  bedrooms INTEGER,
  bathrooms INTEGER,
  area_sqft NUMERIC,
  is_published BOOLEAN DEFAULT false,
  features TEXT[] DEFAULT '{}',
  images TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for tenancy scoping
CREATE INDEX IF NOT EXISTS idx_properties_account ON properties(account_id);

-- Enable RLS
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- Select policy: any member of the account can read
DROP POLICY IF EXISTS properties_select ON properties;
CREATE POLICY properties_select ON properties FOR SELECT USING (
  is_account_member(account_id)
);

-- Modify policy: agent or higher can insert/update/delete
DROP POLICY IF EXISTS properties_modify ON properties;
CREATE POLICY properties_modify ON properties FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Add update trigger for updated_at column
DROP TRIGGER IF EXISTS set_properties_updated_at ON properties;
CREATE TRIGGER set_properties_updated_at BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
