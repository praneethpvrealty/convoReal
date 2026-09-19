-- A saved number that is no longer live (whatsapp_number_profiles,
-- migration 20260918190000) still receives WhatsApp messages: it sits in
-- the same WhatsApp Business Account, so Meta delivers its webhooks, and
-- the handler dropped them because only whatsapp_config is routed. This
-- lets an admin turn on an auto-reply for such a number that points the
-- sender at the live number, at most once per sender per day.

ALTER TABLE public.whatsapp_number_profiles
  ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_reply_message TEXT;

COMMENT ON COLUMN public.whatsapp_number_profiles.auto_reply_enabled IS
  'When true and this profile is not the live number, inbound messages to it get a one-line reply pointing at the live number. Cleared when the profile is activated.';

CREATE TABLE IF NOT EXISTS public.whatsapp_retired_number_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 1,
  last_replied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, phone_number_id, sender_phone)
);

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_retired_number_replies;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.whatsapp_retired_number_replies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.whatsapp_retired_number_replies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_retired_number_replies FROM anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.whatsapp_retired_number_replies TO authenticated;

DROP POLICY IF EXISTS retired_number_replies_select ON public.whatsapp_retired_number_replies;
CREATE POLICY retired_number_replies_select
  ON public.whatsapp_retired_number_replies FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS retired_number_replies_delete ON public.whatsapp_retired_number_replies;
CREATE POLICY retired_number_replies_delete
  ON public.whatsapp_retired_number_replies FOR DELETE
  TO authenticated
  USING (is_account_member(account_id, 'admin'));
