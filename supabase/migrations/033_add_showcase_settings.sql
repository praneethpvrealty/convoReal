-- Create showcase_settings table
CREATE TABLE IF NOT EXISTS showcase_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  website_name TEXT NOT NULL DEFAULT 'ConvoReal',
  website_url TEXT NOT NULL DEFAULT 'https://www.convoreal.com',
  contact_phone TEXT NOT NULL DEFAULT '',
  whatsapp_message_template TEXT NOT NULL DEFAULT 'Hi! I am interested in your property "{title}" in {location}. Please share details.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE showcase_settings ENABLE ROW LEVEL SECURITY;

-- Select policy: any member of the account can read
DROP POLICY IF EXISTS showcase_settings_select ON showcase_settings;
CREATE POLICY showcase_settings_select ON showcase_settings FOR SELECT USING (
  is_account_member(account_id)
);

-- Modify policy: agent or higher can modify settings
DROP POLICY IF EXISTS showcase_settings_modify ON showcase_settings;
CREATE POLICY showcase_settings_modify ON showcase_settings FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Add update trigger for updated_at column
DROP TRIGGER IF EXISTS set_showcase_settings_updated_at ON showcase_settings;
CREATE TRIGGER set_showcase_settings_updated_at BEFORE UPDATE ON showcase_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
