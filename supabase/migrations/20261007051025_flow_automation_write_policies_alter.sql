ALTER POLICY flows_insert ON flows
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY flows_update ON flows
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY flows_delete ON flows
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY flow_nodes_modify ON flow_nodes
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

ALTER POLICY automations_insert ON automations
  WITH CHECK (is_account_writer(account_id, 'agent'));

ALTER POLICY automations_update ON automations
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY automations_delete ON automations
  USING (is_account_writer(account_id, 'agent'));

ALTER POLICY automation_steps_modify ON automation_steps
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
