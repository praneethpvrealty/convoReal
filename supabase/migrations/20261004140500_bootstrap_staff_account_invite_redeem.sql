CREATE OR REPLACE FUNCTION public.bootstrap_staff_account(
  p_user_id UUID,
  p_full_name TEXT,
  p_email TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing profiles%ROWTYPE;
  v_meta JSONB;
  v_prog beta_program%ROWTYPE;
  v_beta beta_invites%ROWTYPE;
  v_inv account_invitations%ROWTYPE;
  v_beta_token TEXT;
  v_team_token TEXT;
  v_taken INTEGER;
  v_quota SMALLINT := 5;
  v_account_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bootstrap_staff_account:' || p_user_id::text, 0));

  SELECT * INTO v_existing FROM profiles WHERE user_id = p_user_id;
  IF FOUND AND v_existing.account_id IS NOT NULL THEN
    UPDATE profiles SET full_name = p_full_name, email = p_email WHERE user_id = p_user_id;
    RETURN v_existing.account_id;
  END IF;

  IF EXISTS (SELECT 1 FROM den_users WHERE auth_user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM buyer_users WHERE auth_user_id = p_user_id) THEN
    RAISE EXCEPTION 'Portfolio owner and buyer logins cannot create a brokerage account. Sign up with an invitation link instead.'
      USING ERRCODE = '42501';
  END IF;

  SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = p_user_id;
  IF v_meta->>'app_context' IN ('den', 'buyer') THEN
    RAISE EXCEPTION 'Portfolio owner and buyer logins cannot create a brokerage account. Sign up with an invitation link instead.'
      USING ERRCODE = '42501';
  END IF;

  v_team_token := NULLIF(v_meta->>'team_invite', '');
  IF v_team_token IS NOT NULL THEN
    SELECT * INTO v_inv FROM account_invitations
    WHERE token_hash = hash_beta_token(v_team_token)
    FOR UPDATE;

    IF FOUND AND v_inv.accepted_at IS NULL AND v_inv.expires_at > NOW() THEN
      INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
      VALUES (p_user_id, p_full_name, p_email, v_inv.account_id, v_inv.role)
      ON CONFLICT (user_id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            account_id = EXCLUDED.account_id,
            account_role = EXCLUDED.account_role;

      UPDATE account_invitations
      SET accepted_at = NOW(),
          accepted_by_user_id = p_user_id
      WHERE id = v_inv.id;

      RETURN v_inv.account_id;
    END IF;
  END IF;

  SELECT * INTO v_prog FROM beta_program WHERE id FOR UPDATE;
  IF FOUND AND v_prog.gate_enabled THEN
    v_beta_token := NULLIF(v_meta->>'beta_invite', '');

    IF v_beta_token IS NULL THEN
      RAISE EXCEPTION 'ConvoReal is invite-only right now. You need an invitation link to create an account.'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_beta FROM beta_invites
    WHERE token_hash = hash_beta_token(v_beta_token)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That invitation link is not valid. Ask whoever invited you for a fresh one.'
        USING ERRCODE = '22023';
    END IF;
    IF v_beta.status = 'revoked' THEN
      RAISE EXCEPTION 'That invitation was withdrawn. Ask whoever invited you for a fresh one.'
        USING ERRCODE = '22023';
    END IF;
    IF v_beta.status = 'accepted' THEN
      RAISE EXCEPTION 'That invitation has already been claimed.'
        USING ERRCODE = '22023';
    END IF;
    IF v_beta.expires_at <= NOW() THEN
      RAISE EXCEPTION 'That invitation has expired. Ask whoever invited you for a fresh one.'
        USING ERRCODE = '22023';
    END IF;

    v_taken := beta_seats_taken();
    IF v_taken >= v_prog.account_cap THEN
      RAISE EXCEPTION 'All % beta seats have been claimed.', v_prog.account_cap
        USING ERRCODE = '22023';
    END IF;

    v_quota := v_prog.default_quota;
  END IF;

  INSERT INTO accounts (name, owner_user_id, beta_invite_id, invite_quota)
  VALUES (p_full_name || '''s Account', p_user_id, v_beta.id, COALESCE(v_quota, 5))
  RETURNING id INTO v_account_id;

  IF v_beta.id IS NOT NULL THEN
    UPDATE beta_invites
    SET status = 'accepted',
        accepted_at = NOW(),
        accepted_by_user_id = p_user_id,
        accepted_account_id = v_account_id,
        seat_number = v_taken + 1
    WHERE id = v_beta.id;
  END IF;

  INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
  VALUES (p_user_id, p_full_name, p_email, v_account_id, 'owner')
  ON CONFLICT (user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        account_id = EXCLUDED.account_id,
        account_role = EXCLUDED.account_role;

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.bootstrap_staff_account(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bootstrap_staff_account(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_staff_account(UUID, TEXT, TEXT) TO service_role;
