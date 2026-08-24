-- Split tenant invite issuance from founder seed issuance.
--
-- The original six-argument SECURITY DEFINER RPC exposed a caller-controlled
-- p_as_seed flag. Any role with EXECUTE could set it and bypass authentication
-- and quota checks. Keep seed creation behind a service-role-only function and
-- make the tenant-facing RPC structurally incapable of requesting a seed.

DROP FUNCTION IF EXISTS public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN);

CREATE FUNCTION public.issue_beta_invite(
  p_token_hash TEXT,
  p_code TEXT,
  p_label TEXT DEFAULT NULL,
  p_invitee_phone TEXT DEFAULT NULL,
  p_invitee_email TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_account_id UUID;
  v_quota SMALLINT;
  v_used INTEGER;
  v_prog beta_program%ROWTYPE;
  v_generation SMALLINT := 0;
  v_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prog FROM beta_program WHERE id FOR UPDATE;

  IF NOT v_prog.issuance_open THEN
    RAISE EXCEPTION 'Beta invitations are closed' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id INTO v_account_id
  FROM profiles p WHERE p.user_id = v_caller;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  SELECT a.invite_quota INTO v_quota
  FROM accounts a WHERE a.id = v_account_id FOR UPDATE;

  SELECT COUNT(*)::INTEGER INTO v_used
  FROM beta_invites
  WHERE issued_by_account_id = v_account_id AND status <> 'revoked';

  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'All % of your invitations have been used', v_quota
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(bi.generation, 0) + 1 INTO v_generation
  FROM accounts a
  LEFT JOIN beta_invites bi ON bi.id = a.beta_invite_id
  WHERE a.id = v_account_id;

  v_expires := NOW() + (v_prog.invite_ttl_days || ' days')::INTERVAL;

  INSERT INTO beta_invites (
    code, token_hash, issued_by_account_id, issued_by_user_id,
    generation, label, invitee_phone, invitee_email, expires_at
  ) VALUES (
    p_code, p_token_hash, v_account_id, v_caller,
    COALESCE(v_generation, 1), p_label, p_invitee_phone, p_invitee_email, v_expires
  ) RETURNING id INTO v_id;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'code', p_code,
    'expires_at', v_expires, 'generation', COALESCE(v_generation, 1),
    'used', v_used + 1, 'quota', v_quota
  );
END;
$$;

ALTER FUNCTION public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated, service_role;

CREATE FUNCTION public.issue_beta_seed(
  p_token_hash TEXT,
  p_code TEXT,
  p_label TEXT DEFAULT NULL,
  p_invitee_phone TEXT DEFAULT NULL,
  p_invitee_email TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prog beta_program%ROWTYPE;
  v_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prog FROM beta_program WHERE id FOR UPDATE;

  IF NOT v_prog.issuance_open THEN
    RAISE EXCEPTION 'Beta invitations are closed' USING ERRCODE = '22023';
  END IF;

  v_expires := NOW() + (v_prog.invite_ttl_days || ' days')::INTERVAL;

  INSERT INTO beta_invites (
    code, token_hash, generation, label,
    invitee_phone, invitee_email, expires_at
  ) VALUES (
    p_code, p_token_hash, 0, p_label,
    p_invitee_phone, p_invitee_email, v_expires
  ) RETURNING id INTO v_id;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'code', p_code,
    'expires_at', v_expires, 'generation', 0
  );
END;
$$;

ALTER FUNCTION public.issue_beta_seed(TEXT, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_beta_seed(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_beta_seed(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Issues a quota-bound beta invite for the authenticated caller account.';
COMMENT ON FUNCTION public.issue_beta_seed(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Issues a generation-zero beta seed; executable only by service_role.';
