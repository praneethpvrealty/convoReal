-- ============================================================
-- 084_set_member_team_rpc.sql
--
-- set_member_team(p_user_id, p_team_id) — assigns a member into a
-- team (or removes them, p_team_id = NULL).
--
-- Why an RPC and not a direct client UPDATE on profiles: the
-- profiles_update RLS policy (migration 017) only allows a user to
-- update their OWN profile row — correct for self-service edits,
-- but it blocks a Manager/Leader from moving a teammate between
-- teams. Same reasoning as set_member_role/remove_account_member
-- in migration 018.
--
-- Team CRUD itself (create/rename/delete a team, set its leader_id)
-- does NOT need an RPC — the teams RLS policies from migration 082
-- already let any admin+ (org_leader+) member write directly to the
-- teams table via the normal client. This RPC only covers the one
-- gap: profiles.team_id.
--
-- Authority, mirroring the design doc's capability list:
--   - Org Manager: assign ANY member (leader or agent) to ANY team,
--     or remove them from their team entirely (NULL).
--   - Org Leader: assign/remove only an ORG_AGENT, and only into/out
--     of their OWN team — cannot add another leader to a team, and
--     cannot touch a different team's roster ("Leader1 shouldn't
--     have access to Leader2's contacts" extends to team membership
--     itself, not just contacts/conversations).
--   - Org Agent: cannot call this at all.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_team(
  p_user_id UUID,
  p_team_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Validate the target team, when one is given (NULL = remove from team).
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
    -- A Leader can only move agents into their OWN team, or remove
    -- an agent who is currently in their own team.
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

ALTER FUNCTION public.set_member_team(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_team(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_team(UUID, UUID) TO authenticated;
