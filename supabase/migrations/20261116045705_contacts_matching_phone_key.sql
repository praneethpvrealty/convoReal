CREATE INDEX IF NOT EXISTS idx_contacts_account_phone_key
  ON public.contacts (account_id, right(regexp_replace(phone, '\D', '', 'g'), 10));

CREATE OR REPLACE FUNCTION public.contacts_matching_phone_key(
  p_account_id UUID,
  p_key TEXT
)
RETURNS TABLE (id UUID, phone TEXT, is_merged BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.phone, c.is_merged
  FROM contacts c
  WHERE c.account_id = p_account_id
    AND is_account_member(p_account_id, 'agent')
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = p_key;
$$;

COMMENT ON FUNCTION public.contacts_matching_phone_key(UUID, TEXT) IS
  'Every contact in one account, merged included and whatever the caller''s role lets them read, whose phone stripped to digits ends in p_key (the last ten digits). Backs the one-contact-per-number check on contact create.';

REVOKE ALL ON FUNCTION public.contacts_matching_phone_key(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contacts_matching_phone_key(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.contacts_matching_phone_key(UUID, TEXT) TO authenticated;
