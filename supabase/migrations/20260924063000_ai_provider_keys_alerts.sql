ALTER TABLE ai_provider_keys ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;

INSERT INTO system_settings (key, value)
VALUES ('ai_call_log', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
