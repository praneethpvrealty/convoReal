CREATE OR REPLACE FUNCTION public.park_automation_wait(
  p_account_id UUID,
  p_automation_id UUID,
  p_user_id UUID,
  p_contact_id UUID,
  p_log_id UUID,
  p_parent_step_id UUID,
  p_branch TEXT,
  p_next_step_position INTEGER,
  p_context JSONB,
  p_run_at TIMESTAMPTZ
)
RETURNS TABLE (superseded_log_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_contact_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('automation_wait:' || p_automation_id::text || ':' || p_contact_id::text, 0)
    );
    RETURN QUERY
    UPDATE automation_pending_executions e
       SET status = 'failed'
     WHERE e.account_id = p_account_id
       AND e.automation_id = p_automation_id
       AND e.contact_id = p_contact_id
       AND e.next_step_position = p_next_step_position
       AND e.parent_step_id IS NOT DISTINCT FROM p_parent_step_id
       AND e.branch IS NOT DISTINCT FROM p_branch
       AND e.status = 'pending'
    RETURNING e.log_id;
  END IF;

  INSERT INTO automation_pending_executions (
    automation_id, account_id, user_id, contact_id, log_id,
    parent_step_id, branch, next_step_position, context, run_at, status
  ) VALUES (
    p_automation_id, p_account_id, p_user_id, p_contact_id, p_log_id,
    p_parent_step_id, p_branch, p_next_step_position, COALESCE(p_context, '{}'::jsonb), p_run_at, 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.park_automation_wait(UUID, UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.park_automation_wait(UUID, UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.park_automation_wait(UUID, UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, JSONB, TIMESTAMPTZ) TO service_role;
