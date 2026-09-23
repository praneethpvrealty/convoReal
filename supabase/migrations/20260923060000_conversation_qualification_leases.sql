CREATE TABLE IF NOT EXISTS public.conversation_qualification_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  holder UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_qualification_leases_account
  ON public.conversation_qualification_leases (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.conversation_qualification_leases;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.conversation_qualification_leases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.conversation_qualification_leases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.conversation_qualification_leases FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversation_qualification_leases TO authenticated;

DROP POLICY IF EXISTS conversation_qualification_leases_select ON public.conversation_qualification_leases;
CREATE POLICY conversation_qualification_leases_select
  ON public.conversation_qualification_leases FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.claim_conversation_qualification_lease(
  p_account_id UUID,
  p_conversation_id UUID,
  p_holder UUID,
  p_ttl_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed UUID;
BEGIN
  INSERT INTO conversation_qualification_leases (account_id, conversation_id, holder, expires_at)
  VALUES (p_account_id, p_conversation_id, p_holder, NOW() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (conversation_id) DO UPDATE
    SET account_id = EXCLUDED.account_id,
        holder = EXCLUDED.holder,
        expires_at = EXCLUDED.expires_at
    WHERE conversation_qualification_leases.expires_at < NOW()
  RETURNING holder INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_conversation_qualification_lease(UUID, UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_conversation_qualification_lease(UUID, UUID, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversation_qualification_lease(UUID, UUID, UUID, INTEGER) TO service_role;
