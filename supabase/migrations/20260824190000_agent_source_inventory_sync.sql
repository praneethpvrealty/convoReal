CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_account_source_unique
  ON properties(account_id, source_property_id);

CREATE OR REPLACE FUNCTION public.find_agent_profile_accounts(p_phone_last10 TEXT)
RETURNS TABLE (user_id UUID, account_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pr.user_id, pr.account_id
  FROM profiles pr
  WHERE p_phone_last10 <> ''
    AND right(regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g'), 10) = p_phone_last10;
$$;

REVOKE ALL ON FUNCTION public.find_agent_profile_accounts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_agent_profile_accounts(TEXT) FROM anon, authenticated;
