-- Alter default values for showcase_settings to ConvoReal / convoreal.com branding
ALTER TABLE showcase_settings ALTER COLUMN website_name SET DEFAULT 'ConvoReal';
ALTER TABLE showcase_settings ALTER COLUMN website_url SET DEFAULT 'https://www.convoreal.com';
