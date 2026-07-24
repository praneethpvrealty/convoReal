-- Per-account notification channel preferences. One row per configurable
-- event (see src/lib/notifications/events.ts). Absence of a row means the
-- event's built-in defaults apply, so this table only stores overrides.

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_account
  ON notification_preferences (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON notification_preferences;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_select ON notification_preferences;
CREATE POLICY notification_preferences_select ON notification_preferences
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS notification_preferences_write ON notification_preferences;
CREATE POLICY notification_preferences_write ON notification_preferences
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
