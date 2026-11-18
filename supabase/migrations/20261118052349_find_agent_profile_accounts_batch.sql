CREATE OR REPLACE FUNCTION public.find_agent_profile_accounts_batch(p_phone_last10s TEXT[])
RETURNS TABLE (phone_last10 TEXT, user_id UUID, account_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT matched.phone_last10, matched.user_id, matched.account_id
  FROM (
    SELECT
      right(regexp_replace(COALESCE(pr.phone, ''), '\D', '', 'g'), 10) AS phone_last10,
      pr.user_id,
      pr.account_id
    FROM profiles pr
    WHERE pr.phone IS NOT NULL
  ) matched
  WHERE length(matched.phone_last10) = 10
    AND matched.phone_last10 = ANY (p_phone_last10s);
$$;

REVOKE ALL ON FUNCTION public.find_agent_profile_accounts_batch(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_agent_profile_accounts_batch(TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_agent_profile_accounts_batch(TEXT[]) TO service_role;
