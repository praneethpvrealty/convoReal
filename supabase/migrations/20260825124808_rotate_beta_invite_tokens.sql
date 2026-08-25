CREATE FUNCTION public.rotate_beta_invite(
  p_id UUID,
  p_token_hash TEXT,
  p_code TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_inv public.beta_invites%ROWTYPE;
  v_ttl_days SMALLINT;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_code !~ '^CONVO-[23456789BCDFGHJKMNPQRSTVWXYZ]{4}$' THEN
    RAISE EXCEPTION 'Invalid invitation credentials' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv
  FROM public.beta_invites
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;

  IF v_inv.issued_by_account_id IS NULL
     OR NOT public.is_account_member(v_inv.issued_by_account_id, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending invitation can be resent'
      USING ERRCODE = '22023';
  END IF;

  SELECT invite_ttl_days INTO v_ttl_days
  FROM public.beta_program
  WHERE id AND issuance_open
  FOR UPDATE;

  IF v_ttl_days IS NULL THEN
    RAISE EXCEPTION 'Beta invitations are closed' USING ERRCODE = '22023';
  END IF;

  v_expires := NOW() + (v_ttl_days || ' days')::INTERVAL;

  UPDATE public.beta_invites
  SET token_hash = p_token_hash,
      code = p_code,
      issued_by_user_id = v_caller,
      expires_at = v_expires
  WHERE id = p_id;

  RETURN json_build_object(
    'ok', true,
    'id', v_inv.id,
    'code', p_code,
    'label', v_inv.label,
    'invitee_phone', v_inv.invitee_phone,
    'expires_at', v_expires
  );
END;
$$;

ALTER FUNCTION public.rotate_beta_invite(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rotate_beta_invite(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rotate_beta_invite(UUID, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.rotate_beta_invite(UUID, TEXT, TEXT) IS
  'Atomically rotates a pending tenant beta invite token for an authenticated account admin while preserving its recipient and quota seat.';
