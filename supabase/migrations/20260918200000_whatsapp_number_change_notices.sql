-- When a brokerage switches its live WhatsApp number (saved-number
-- profiles, migration 20260918190000), the contacts it was talking to
-- see the next message arrive from an unknown number. This records the
-- switch on the live row and keeps a ledger of who has been told, so the
-- contact_number_update template goes to each contact exactly once —
-- whether from the one-tap "notify recent contacts" action or as the
-- precursor the dispatcher sends ahead of a routine message during the
-- seven days after the switch.

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS previous_display_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS number_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.whatsapp_config.number_changed_at IS
  'Set when the live phone_number_id changes to a different number. The number-change notice is offered and sent as a precursor for 7 days from here.';

CREATE TABLE IF NOT EXISTS public.whatsapp_number_change_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  previous_display_phone_number TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'precursor')),
  channel TEXT NOT NULL DEFAULT 'pending'
    CHECK (channel IN ('pending', 'template', 'freeform')),
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id, phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_number_change_notices_account_number
  ON public.whatsapp_number_change_notices (account_id, phone_number_id);

ALTER TABLE public.whatsapp_number_change_notices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_number_change_notices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.whatsapp_number_change_notices TO authenticated;

DROP POLICY IF EXISTS number_change_notices_select ON public.whatsapp_number_change_notices;
CREATE POLICY number_change_notices_select
  ON public.whatsapp_number_change_notices FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS number_change_notices_insert ON public.whatsapp_number_change_notices;
CREATE POLICY number_change_notices_insert
  ON public.whatsapp_number_change_notices FOR INSERT
  TO authenticated
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS number_change_notices_update ON public.whatsapp_number_change_notices;
CREATE POLICY number_change_notices_update
  ON public.whatsapp_number_change_notices FOR UPDATE
  TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS number_change_notices_delete ON public.whatsapp_number_change_notices;
CREATE POLICY number_change_notices_delete
  ON public.whatsapp_number_change_notices FOR DELETE
  TO authenticated
  USING (is_account_member(account_id, 'admin'));

-- Contacts who exchanged a message since p_since and have not yet been
-- told about p_phone_number_id. Aggregated in SQL with a correlated NOT
-- EXISTS so the ledger never travels in a URL (AGENTS.md §2.6).
CREATE OR REPLACE FUNCTION public.whatsapp_number_change_audience(
  p_account_id UUID,
  p_since TIMESTAMPTZ,
  p_phone_number_id TEXT
)
RETURNS TABLE (
  contact_id UUID,
  name TEXT,
  preferred_language TEXT,
  last_message_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.preferred_language,
    MAX(cv.last_message_at)
  FROM contacts c
  JOIN conversations cv
    ON cv.contact_id = c.id
   AND cv.account_id = c.account_id
  WHERE c.account_id = p_account_id
    AND is_account_member(p_account_id)
    AND cv.last_message_at >= p_since
    AND c.phone IS NOT NULL
    AND COALESCE(c.is_dead, false) = false
    AND COALESCE(c.is_archived, false) = false
    AND COALESCE(c.chain_only, false) = false
    AND COALESCE(c.is_merged, false) = false
    AND NOT EXISTS (
      SELECT 1
      FROM whatsapp_number_change_notices n
      WHERE n.account_id = c.account_id
        AND n.contact_id = c.id
        AND n.phone_number_id = p_phone_number_id
    )
  GROUP BY c.id, c.name, c.preferred_language
  ORDER BY MAX(cv.last_message_at) DESC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_number_change_audience(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_number_change_audience(UUID, TIMESTAMPTZ, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_number_change_audience(UUID, TIMESTAMPTZ, TEXT) TO authenticated;
