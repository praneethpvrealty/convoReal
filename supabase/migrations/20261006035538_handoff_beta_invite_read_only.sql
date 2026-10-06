CREATE OR REPLACE FUNCTION public.handoff_contact(
  p_contact_id UUID,
  p_new_agent_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_account_id UUID;
  v_caller_role org_role_enum;
  v_caller_team_id UUID;
  v_contact_account_id UUID;
  v_contact_agent_id UUID;
  v_contact_team_id UUID;
  v_target_account_id UUID;
  v_target_team_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, org_role, team_id
  INTO v_caller_account_id, v_caller_role, v_caller_team_id
  FROM profiles
  WHERE user_id = v_caller_id;

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF NOT is_account_writer(v_caller_account_id, 'agent') THEN
    RAISE EXCEPTION 'Read-only members cannot make changes.'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id, assigned_agent_id, assigned_team_id
  INTO v_contact_account_id, v_contact_agent_id, v_contact_team_id
  FROM contacts
  WHERE id = p_contact_id;

  IF v_contact_account_id IS NULL THEN
    RAISE EXCEPTION 'Contact not found' USING ERRCODE = '22023';
  END IF;

  IF v_contact_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Contact is not in your account' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, team_id
  INTO v_target_account_id, v_target_team_id
  FROM profiles
  WHERE user_id = p_new_agent_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target agent not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target agent is not in your account' USING ERRCODE = '42501';
  END IF;

  -- Authority check, scoped by the caller's own role.
  IF v_caller_role = 'org_manager' THEN
    -- Unrestricted within the account.
    NULL;
  ELSIF v_caller_role = 'org_leader' THEN
    IF v_contact_team_id IS DISTINCT FROM v_caller_team_id THEN
      RAISE EXCEPTION 'Leaders can only hand off contacts within their own team'
        USING ERRCODE = '42501';
    END IF;
    IF v_target_team_id IS DISTINCT FROM v_caller_team_id THEN
      RAISE EXCEPTION 'Leaders can only hand off to an agent within their own team'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_caller_role = 'org_agent' THEN
    IF v_contact_agent_id IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'You can only hand off contacts assigned to you'
        USING ERRCODE = '42501';
    END IF;
    IF v_target_team_id IS DISTINCT FROM v_caller_team_id THEN
      RAISE EXCEPTION 'Agents can only hand off to a teammate within their own team'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- assigned_team_id follows the new agent's own team, so the
  -- denormalized column driving RLS/routing stays consistent even
  -- when a Manager hands a contact across team boundaries.
  UPDATE contacts
  SET assigned_agent_id = p_new_agent_id,
      assigned_team_id = v_target_team_id,
      updated_at = NOW()
  WHERE id = p_contact_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_beta_invite(
  p_token_hash TEXT,
  p_code TEXT,
  p_label TEXT DEFAULT NULL,
  p_invitee_phone TEXT DEFAULT NULL,
  p_invitee_email TEXT DEFAULT NULL
)
RETURNS JSON
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

  IF NOT is_account_writer(v_account_id, 'agent') THEN
    RAISE EXCEPTION 'Read-only members cannot make changes.'
      USING ERRCODE = '42501';
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
