-- ============================================================
-- 20260929054500_journey_compartments_scope_rls.sql
-- Tie journey_compartments rows to the account's current scope.
--
-- With accounts.journey_compartment_scope = 'team' only ownerless
-- (user_id NULL) rows are readable and writable; with 'agent' only
-- the caller's own rows are. A direct PostgREST write can then no
-- longer plant rows for the scope that is not in force, which would
-- surface unexpectedly after an admin switches the scope.
-- ============================================================

CREATE OR REPLACE FUNCTION public.journey_compartment_row_in_scope(
  p_account_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN a.journey_compartment_scope = 'agent'
      THEN p_user_id IS NOT NULL AND p_user_id = auth.uid()
    ELSE p_user_id IS NULL
  END
  FROM accounts a
  WHERE a.id = p_account_id
$$;

REVOKE ALL ON FUNCTION public.journey_compartment_row_in_scope(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.journey_compartment_row_in_scope(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Members view journey compartments" ON journey_compartments;
CREATE POLICY "Members view journey compartments" ON journey_compartments
  FOR SELECT USING (
    is_account_member(account_id)
    AND journey_compartment_row_in_scope(account_id, user_id)
  );

DROP POLICY IF EXISTS "Agents insert journey compartments" ON journey_compartments;
CREATE POLICY "Agents insert journey compartments" ON journey_compartments
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'agent')
    AND journey_compartment_row_in_scope(account_id, user_id)
  );

DROP POLICY IF EXISTS "Agents update journey compartments" ON journey_compartments;
CREATE POLICY "Agents update journey compartments" ON journey_compartments
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND journey_compartment_row_in_scope(account_id, user_id)
  )
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND journey_compartment_row_in_scope(account_id, user_id)
  );

DROP POLICY IF EXISTS "Agents delete journey compartments" ON journey_compartments;
CREATE POLICY "Agents delete journey compartments" ON journey_compartments
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND journey_compartment_row_in_scope(account_id, user_id)
  );
