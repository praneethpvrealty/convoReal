CREATE OR REPLACE FUNCTION public.is_account_writer(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'agent'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_account_member(target_account_id, min_role)
    AND NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = target_account_id
        AND p.is_read_only
    );
$$;

REVOKE ALL ON FUNCTION public.is_account_writer(UUID, account_role_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_writer(UUID, account_role_enum) TO authenticated, service_role;

DROP POLICY IF EXISTS flows_insert ON flows;
CREATE POLICY flows_insert ON flows FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS flows_update ON flows;
CREATE POLICY flows_update ON flows FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS flows_delete ON flows;
CREATE POLICY flows_delete ON flows FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS flow_nodes_modify ON flow_nodes;
CREATE POLICY flow_nodes_modify ON flow_nodes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_nodes.flow_id
      AND is_account_writer(f.account_id, 'agent')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_nodes.flow_id
      AND is_account_writer(f.account_id, 'agent')
  ));

DROP POLICY IF EXISTS automations_insert ON automations;
CREATE POLICY automations_insert ON automations FOR INSERT
  WITH CHECK (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS automations_update ON automations;
CREATE POLICY automations_update ON automations FOR UPDATE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS automations_delete ON automations;
CREATE POLICY automations_delete ON automations FOR DELETE
  USING (is_account_writer(account_id, 'agent'));

DROP POLICY IF EXISTS automation_steps_modify ON automation_steps;
CREATE POLICY automation_steps_modify ON automation_steps FOR ALL
  USING (EXISTS (
    SELECT 1 FROM automations a
    WHERE a.id = automation_steps.automation_id
      AND is_account_writer(a.account_id, 'agent')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM automations a
    WHERE a.id = automation_steps.automation_id
      AND is_account_writer(a.account_id, 'agent')
  ));
