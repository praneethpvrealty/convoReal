-- Create agency_services table
CREATE TABLE IF NOT EXISTS agency_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS for agency_services
ALTER TABLE agency_services ENABLE ROW LEVEL SECURITY;

-- Select policy: public can read active services, members can read all
DROP POLICY IF EXISTS agency_services_select ON agency_services;
CREATE POLICY agency_services_select ON agency_services FOR SELECT USING (
  is_active = true OR is_account_member(account_id)
);

-- Modify policy: agent or higher can modify services
DROP POLICY IF EXISTS agency_services_modify ON agency_services;
CREATE POLICY agency_services_modify ON agency_services FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Add update trigger for updated_at column
DROP TRIGGER IF EXISTS set_agency_services_updated_at ON agency_services;
CREATE TRIGGER set_agency_services_updated_at BEFORE UPDATE ON agency_services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create agency_articles table
CREATE TABLE IF NOT EXISTS agency_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,
  image_url TEXT,
  published_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS for agency_articles
ALTER TABLE agency_articles ENABLE ROW LEVEL SECURITY;

-- Select policy: public can read active articles, members can read all
DROP POLICY IF EXISTS agency_articles_select ON agency_articles;
CREATE POLICY agency_articles_select ON agency_articles FOR SELECT USING (
  (is_active = true AND published_at <= NOW()) OR is_account_member(account_id)
);

-- Modify policy: agent or higher can modify articles
DROP POLICY IF EXISTS agency_articles_modify ON agency_articles;
CREATE POLICY agency_articles_modify ON agency_articles FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Add update trigger for updated_at column
DROP TRIGGER IF EXISTS set_agency_articles_updated_at ON agency_articles;
CREATE TRIGGER set_agency_articles_updated_at BEFORE UPDATE ON agency_articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
