CREATE INDEX IF NOT EXISTS idx_contacts_account_phone_key
  ON public.contacts (account_id, right(regexp_replace(phone, '\D', '', 'g'), 10));

CREATE OR REPLACE FUNCTION public.visible_contact_with_phone_key(
  p_account_id UUID,
  p_key TEXT
)
RETURNS TABLE (id UUID, name TEXT, second_name TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.second_name
  FROM contacts c
  WHERE c.account_id = p_account_id
    AND NOT c.is_merged
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = p_key
  ORDER BY c.created_at, c.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.visible_contact_with_phone_key(UUID, TEXT) IS
  'The oldest unmerged contact the caller can read (RLS applies) whose phone stripped to digits ends in p_key, the last ten digits.';

REVOKE ALL ON FUNCTION public.visible_contact_with_phone_key(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.visible_contact_with_phone_key(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.visible_contact_with_phone_key(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.account_has_phone_key(
  p_account_id UUID,
  p_key TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_account_member(p_account_id, 'agent')
    AND EXISTS (
      SELECT 1
      FROM contacts c
      WHERE c.account_id = p_account_id
        AND NOT c.is_merged
        AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = p_key
    );
$$;

COMMENT ON FUNCTION public.account_has_phone_key(UUID, TEXT) IS
  'Whether any unmerged contact in the account, readable by the caller or not, has a phone whose last ten digits are p_key. Returns nothing about that contact.';

REVOKE ALL ON FUNCTION public.account_has_phone_key(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_has_phone_key(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.account_has_phone_key(UUID, TEXT) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.contacts_matching_phone_key(uuid, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.contacts_matching_phone_key(UUID, TEXT) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
