-- whatsapp_config holds exactly one live number per account, and every
-- consumer (webhook routing, sending, templates, flows) reads it. A
-- brokerage that owns more than one WhatsApp number had to re-enter the
-- credentials and the two-step PIN each time it moved between them.
--
-- whatsapp_number_profiles keeps every Official API number the account
-- has ever saved, with its encrypted token and its Meta registration
-- state. Activating a profile copies it back into whatsapp_config, so
-- the switch needs no PIN and no re-registration. Only one number is
-- live at a time: the rest stay saved, and Meta events for them are not
-- delivered to ConvoReal until they are activated again.
--
-- phone_number_id is unique across the whole instance, matching
-- whatsapp_config: a number belongs to one brokerage.

CREATE TABLE IF NOT EXISTS public.whatsapp_number_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '',
  phone_number_id TEXT NOT NULL,
  display_phone_number TEXT,
  verified_name TEXT,
  waba_id TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT,
  catalog_id TEXT,
  auto_sync_catalog BOOLEAN NOT NULL DEFAULT false,
  registered_at TIMESTAMPTZ,
  subscribed_apps_at TIMESTAMPTZ,
  last_registration_error TEXT,
  last_activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_number_profiles_account
  ON public.whatsapp_number_profiles (account_id, created_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_number_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_number_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.whatsapp_number_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_number_profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.whatsapp_number_profiles TO authenticated;

DROP POLICY IF EXISTS whatsapp_number_profiles_select ON public.whatsapp_number_profiles;
CREATE POLICY whatsapp_number_profiles_select
  ON public.whatsapp_number_profiles FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS whatsapp_number_profiles_insert ON public.whatsapp_number_profiles;
CREATE POLICY whatsapp_number_profiles_insert
  ON public.whatsapp_number_profiles FOR INSERT
  TO authenticated
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_number_profiles_update ON public.whatsapp_number_profiles;
CREATE POLICY whatsapp_number_profiles_update
  ON public.whatsapp_number_profiles FOR UPDATE
  TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_number_profiles_delete ON public.whatsapp_number_profiles;
CREATE POLICY whatsapp_number_profiles_delete
  ON public.whatsapp_number_profiles FOR DELETE
  TO authenticated
  USING (is_account_member(account_id, 'admin'));

-- Every number that is live today becomes its own saved profile, so an
-- account's first switch away from it can switch back.
INSERT INTO public.whatsapp_number_profiles (
  account_id, created_by, label, phone_number_id, display_phone_number,
  waba_id, access_token, verify_token, catalog_id, auto_sync_catalog,
  registered_at, subscribed_apps_at, last_registration_error,
  last_activated_at, created_at
)
SELECT
  c.account_id, c.user_id, '', c.phone_number_id, c.display_phone_number,
  c.waba_id, c.access_token, c.verify_token, c.catalog_id,
  COALESCE(c.auto_sync_catalog, false),
  c.registered_at, c.subscribed_apps_at, c.last_registration_error,
  c.connected_at, COALESCE(c.created_at, NOW())
FROM public.whatsapp_config c
WHERE COALESCE(c.integration_type, 'official_api') = 'official_api'
  AND c.phone_number_id IS NOT NULL
  AND c.access_token IS NOT NULL
  AND c.account_id IS NOT NULL
ON CONFLICT (phone_number_id) DO NOTHING;

COMMENT ON TABLE public.whatsapp_number_profiles IS
  'Every Official API WhatsApp number an account has saved. whatsapp_config stays the single live number; activating a profile copies it there without a PIN or re-registration.';
