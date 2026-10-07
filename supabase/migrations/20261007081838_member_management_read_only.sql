CREATE OR REPLACE FUNCTION public.set_member_role(p_user_id uuid, p_new_role account_role_enum)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF NOT is_account_writer(v_caller_account_id, 'agent') THEN
    RAISE EXCEPTION 'Read-only members cannot make changes.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_org_role(p_user_id uuid, p_new_role org_role_enum)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role org_role_enum;
  v_target_account_id UUID;
  v_target_role org_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, org_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF NOT is_account_writer(v_caller_account_id, 'agent') THEN
    RAISE EXCEPTION 'Read-only members cannot make changes.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'org_manager' THEN
    RAISE EXCEPTION 'This action requires the Org Manager role'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, org_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'org_manager' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to change the Manager'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'org_manager' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to Manager'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET org_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_team(p_user_id uuid, p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_account_id UUID;
  v_caller_role org_role_enum;
  v_caller_team_id UUID;
  v_target_account_id UUID;
  v_target_role org_role_enum;
  v_team_account_id UUID;
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

  IF v_caller_role NOT IN ('org_manager', 'org_leader') THEN
    RAISE EXCEPTION 'This action requires the Org Leader role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id, org_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF p_team_id IS NOT NULL THEN
    SELECT account_id INTO v_team_account_id FROM teams WHERE id = p_team_id;
    IF v_team_account_id IS NULL THEN
      RAISE EXCEPTION 'Team not found' USING ERRCODE = '22023';
    END IF;
    IF v_team_account_id <> v_caller_account_id THEN
      RAISE EXCEPTION 'Team is not in your account' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_caller_role = 'org_leader' THEN
    IF v_target_role <> 'org_agent' THEN
      RAISE EXCEPTION 'Leaders can only manage Org Agent team membership'
        USING ERRCODE = '42501';
    END IF;
    IF p_team_id IS NOT NULL AND p_team_id <> v_caller_team_id THEN
      RAISE EXCEPTION 'Leaders can only assign agents to their own team'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE profiles
  SET team_id = p_team_id
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF NOT is_account_writer(v_caller_account_id, 'agent') THEN
    RAISE EXCEPTION 'Read-only members cannot make changes.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_account_ownership(p_new_owner_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF NOT is_account_writer(v_caller_account_id, 'agent') THEN
    RAISE EXCEPTION 'Read-only members cannot make changes.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_new_owner_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid();

  UPDATE profiles SET account_role = 'owner'
  WHERE user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bot_instructions_fired(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_bot_instructions_fired(UUID, UUID[]) TO service_role;
