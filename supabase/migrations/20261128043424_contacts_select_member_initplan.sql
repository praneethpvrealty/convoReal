-- ============================================================
-- 20261128043424_contacts_select_member_initplan.sql
--
-- contacts_select called is_account_member(account_id) once for every
-- contact row it considered. The function is SECURITY DEFINER, so
-- Postgres cannot fold it into the plan: an exact count over an
-- account's contacts paid one function call per contact (about 35 ms
-- for 864 contacts, growing with the account), and the Contacts list
-- asks for that count on every page.
--
-- member_account_ids() answers the same question once per statement:
-- it returns the accounts the caller belongs to at the given minimum
-- role, with the role ranking copied from is_account_member(), and the
-- policy compares account_id against that set. The visibility rules
-- (manager and coordinator see all, an agent sees their own, a team
-- sees its team's, a leader also sees unassigned) are unchanged; their
-- auth.uid() calls are wrapped in a scalar subquery so they too are
-- evaluated once.
--
-- Not additive: it replaces the read policy on contacts. Apply after
-- the pull request has merged into main.
-- ============================================================

CREATE OR REPLACE FUNCTION public.member_account_ids(
  min_role account_role_enum DEFAULT 'viewer'
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.account_id
  FROM profiles p
  WHERE p.user_id = auth.uid()
    AND CASE min_role
          WHEN 'owner'       THEN 4
          WHEN 'admin'       THEN 3
          WHEN 'coordinator' THEN 2
          WHEN 'agent'       THEN 2
          WHEN 'viewer'      THEN 1
        END
      <=
        CASE p.org_role
          WHEN 'org_manager'     THEN 4
          WHEN 'org_leader'      THEN 3
          WHEN 'org_coordinator' THEN 2
          WHEN 'org_agent'       THEN 2
        END;
$$;

REVOKE ALL ON FUNCTION public.member_account_ids(account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_account_ids(account_role_enum)
  TO anon, authenticated, service_role;

ALTER POLICY contacts_select ON contacts
  USING (
    account_id IN (SELECT public.member_account_ids())
    AND (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = (SELECT auth.uid())
          AND p.account_id = contacts.account_id
          AND p.org_role IN ('org_manager', 'org_coordinator')
      )
      OR assigned_agent_id = (SELECT auth.uid())
      OR (
        assigned_team_id IS NOT NULL
        AND assigned_team_id = (
          SELECT p.team_id FROM profiles p
          WHERE p.user_id = (SELECT auth.uid())
            AND p.account_id = contacts.account_id
        )
      )
      OR (
        assigned_agent_id IS NULL
        AND assigned_team_id IS NULL
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.user_id = (SELECT auth.uid())
            AND p.account_id = contacts.account_id
            AND p.org_role IN ('org_manager', 'org_leader')
        )
      )
    )
  );
