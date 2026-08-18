ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS client_quiet_hours_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS client_quiet_hours_start TIME NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS client_quiet_hours_end TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS agent_quiet_hours_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS agent_quiet_hours_start TIME NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS agent_quiet_hours_end TIME NOT NULL DEFAULT '07:00';

CREATE TABLE IF NOT EXISTS public.deferred_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  send_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  send_push BOOLEAN NOT NULL DEFAULT FALSE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  whatsapp_text TEXT,
  entity_type TEXT,
  entity_id UUID,
  link TEXT,
  claimed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deferred_notification_deliveries_due
  ON public.deferred_notification_deliveries (due_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deferred_notification_deliveries_account
  ON public.deferred_notification_deliveries (account_id);
CREATE INDEX IF NOT EXISTS idx_deferred_notification_deliveries_user
  ON public.deferred_notification_deliveries (user_id);

ALTER TABLE public.deferred_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deferred_notification_deliveries FROM anon, authenticated;
GRANT ALL ON public.deferred_notification_deliveries TO service_role;

COMMENT ON TABLE public.deferred_notification_deliveries IS
  'Service-role queue for WhatsApp and push reminder delivery after account quiet hours.';
