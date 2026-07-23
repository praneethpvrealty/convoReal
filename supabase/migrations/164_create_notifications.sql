-- ============================================================
-- 164_create_notifications.sql
--
-- In-app notification centre + push-device registry.
--
-- `notifications` is the per-user feed backing the dashboard bell.
-- Rows are the recipient's own (user_id = the assigned agent /
-- account owner being alerted), written only by the service-role
-- side (createNotification) — there is no client INSERT policy.
-- The recipient reads their feed and marks rows read via the
-- SELECT / UPDATE policies below. Added to supabase_realtime so the
-- bell updates live, exactly like messages/conversations.
--
-- `notification_devices` stores Expo push tokens per user/device so
-- the same createNotification fan-out can push to the mobile app.
-- Unlike notifications, the mobile client manages its own rows
-- through its Supabase JWT, so it carries full owner CRUD policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The recipient being alerted (assigned agent / account owner).
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  -- What the notification points at, so the bell can deep-link.
  entity_type TEXT,
  entity_id UUID,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_time
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_account_time
  ON notifications (account_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_notifications_updated_at ON notifications;
CREATE TRIGGER set_notifications_updated_at BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Recipients see and mark-read only their own notifications; inserts
-- come from the service-role createNotification helper (no policy).
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (
  user_id = auth.uid() AND is_account_member(account_id)
);

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (
  user_id = auth.uid()
) WITH CHECK (
  user_id = auth.uid()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notification_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_notification_devices_user
  ON notification_devices (user_id);

ALTER TABLE notification_devices ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_notification_devices_updated_at ON notification_devices;
CREATE TRIGGER set_notification_devices_updated_at BEFORE UPDATE ON notification_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The mobile client registers/removes its own device tokens through
-- its Supabase JWT, so owners get full CRUD over their own rows.
DROP POLICY IF EXISTS notification_devices_select ON notification_devices;
CREATE POLICY notification_devices_select ON notification_devices FOR SELECT USING (
  user_id = auth.uid()
);

DROP POLICY IF EXISTS notification_devices_insert ON notification_devices;
CREATE POLICY notification_devices_insert ON notification_devices FOR INSERT WITH CHECK (
  user_id = auth.uid() AND is_account_member(account_id)
);

DROP POLICY IF EXISTS notification_devices_update ON notification_devices;
CREATE POLICY notification_devices_update ON notification_devices FOR UPDATE USING (
  user_id = auth.uid()
) WITH CHECK (
  user_id = auth.uid()
);

DROP POLICY IF EXISTS notification_devices_delete ON notification_devices;
CREATE POLICY notification_devices_delete ON notification_devices FOR DELETE USING (
  user_id = auth.uid()
);
