CREATE TABLE IF NOT EXISTS public.portal_listing_expiry_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.property_portal_listings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reminder_key TEXT NOT NULL,
  reminder_kind TEXT NOT NULL CHECK (
    reminder_kind IN ('missing_expiry', 'upcoming', 'expiry_day', 'overdue')
  ),
  due_on DATE NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  delivery_result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, reminder_key)
);

CREATE INDEX IF NOT EXISTS idx_portal_expiry_reminder_log_account
  ON public.portal_listing_expiry_reminder_log (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_expiry_reminder_log_listing
  ON public.portal_listing_expiry_reminder_log (listing_id, due_on DESC);

DROP TRIGGER IF EXISTS set_portal_expiry_reminder_log_updated_at
  ON public.portal_listing_expiry_reminder_log;
CREATE TRIGGER set_portal_expiry_reminder_log_updated_at
  BEFORE UPDATE ON public.portal_listing_expiry_reminder_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.portal_listing_expiry_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_expiry_reminder_log_select
  ON public.portal_listing_expiry_reminder_log;
CREATE POLICY portal_expiry_reminder_log_select
  ON public.portal_listing_expiry_reminder_log
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

REVOKE ALL ON public.portal_listing_expiry_reminder_log FROM anon, authenticated;
GRANT SELECT ON public.portal_listing_expiry_reminder_log TO authenticated;
GRANT ALL ON public.portal_listing_expiry_reminder_log TO service_role;

COMMENT ON TABLE public.portal_listing_expiry_reminder_log IS
  'One claim per portal listing and reminder stage, used to deduplicate expiry notifications across cron runs.';
