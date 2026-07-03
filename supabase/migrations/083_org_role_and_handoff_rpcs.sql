-- ============================================================
-- 083_org_role_and_handoff_rpcs.sql
--
-- Two new SECURITY DEFINER RPCs, same supervised-escape-hatch
-- pattern as 018_account_member_rpcs.sql (self-checked authority,
-- 42501/22023 error contract, REVOKE ALL + GRANT EXECUTE):
--
--   1. set_member_org_role — Org Manager promotes an agent to
--      leader (or demotes a leader back to agent). Only changes
--      the role; attaching someone as a specific team's leader is
--      a separate action (Settings > Teams tab, Phase 4).
--
--   2. handoff_contact — reassigns a contact to a different agent,
--      with authority scoped by the caller's own role:
--        - Org Manager: any contact, to any agent in the account.
--        - Org Leader: only contacts currently in their own team,
--          to an agent also in their own team. A Leader can never
--          touch another team's contacts — RLS already hides those
--          rows entirely, and this function re-checks explicitly
--          rather than relying on that alone.
--        - Org Agent: only contacts currently assigned to
--          themselves, to a teammate (same team). An Agent cannot
--          hand off to someone outside their own team.
--      Cross-team handoff (Leader1's contact to Leader2's team) is
--      intentionally impossible through this function for anyone
--      except an Org Manager — matches "only managers can
--      intervene" from the request.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- set_member_org_role(p_user_id, p_new_role)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_org_role(
  p_user_id UUID,
  p_new_role org_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Only the Org Manager promotes/demotes leaders — Leaders manage
  -- their own team's membership via set_member_team (Phase 4), not
  -- role changes.
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

  -- Manager role changes go through transfer_account_ownership,
  -- same rule as set_member_role's owner carve-out.
  IF v_target_role = 'org_manager' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to change the Manager'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'org_manager' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to Manager'
      USING ERRCODE = '22023';
  END IF;

  -- Demoting a Leader back to Agent leaves them on their current
  -- team (as a regular member) rather than clearing team_id — a
  -- Manager can reassign their team separately if needed.
  UPDATE profiles
  SET org_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_org_role(UUID, org_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_org_role(UUID, org_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_org_role(UUID, org_role_enum) TO authenticated;

-- ============================================================
-- handoff_contact(p_contact_id, p_new_agent_id)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handoff_contact(
  p_contact_id UUID,
  p_new_agent_id UUID
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

ALTER FUNCTION public.handoff_contact(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handoff_contact(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handoff_contact(UUID, UUID) TO authenticated;
