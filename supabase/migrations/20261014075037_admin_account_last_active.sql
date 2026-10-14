CREATE OR REPLACE FUNCTION public.admin_account_last_active()
RETURNS TABLE (
  account_id UUID,
  last_active_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.account_id,
    MAX(GREATEST(u.last_sign_in_at, s.refreshed_at AT TIME ZONE 'UTC', s.updated_at)) AS last_active_at
  FROM profiles p
  JOIN auth.users u ON u.id = p.user_id
  LEFT JOIN auth.sessions s ON s.user_id = u.id
  WHERE p.account_id IS NOT NULL
  GROUP BY p.account_id
$$;

REVOKE ALL ON FUNCTION public.admin_account_last_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_last_active() TO service_role;
