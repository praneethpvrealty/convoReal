ALTER TABLE public.automation_pending_executions
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE public.automation_pending_executions
  ADD COLUMN IF NOT EXISTS claim_token UUID;

ALTER TABLE public.automation_pending_executions
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_automation_pending_running
  ON public.automation_pending_executions (claimed_at)
  WHERE status = 'running';

CREATE OR REPLACE FUNCTION public.claim_automation_pending_executions(
  p_limit INTEGER,
  p_stale_seconds INTEGER,
  p_max_attempts INTEGER
)
RETURNS SETOF public.automation_pending_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE automation_pending_executions
     SET status = 'failed',
         claim_token = NULL
   WHERE status = 'running'
     AND (claimed_at IS NULL OR claimed_at < NOW() - make_interval(secs => p_stale_seconds))
     AND attempts >= p_max_attempts;

  RETURN QUERY
  UPDATE automation_pending_executions ape
     SET status = 'running',
         claimed_at = NOW(),
         claim_token = gen_random_uuid(),
         attempts = ape.attempts + 1
   WHERE ape.id IN (
     SELECT id
       FROM automation_pending_executions
      WHERE (status = 'pending' AND run_at <= NOW())
         OR (status = 'running'
             AND (claimed_at IS NULL OR claimed_at < NOW() - make_interval(secs => p_stale_seconds))
             AND attempts < p_max_attempts)
      ORDER BY run_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING ape.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_automation_pending_execution(
  p_id UUID,
  p_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE automation_pending_executions
     SET status = 'pending',
         claimed_at = NULL,
         claim_token = NULL,
         attempts = GREATEST(attempts - 1, 0)
   WHERE id = p_id
     AND claim_token = p_claim_token
     AND status = 'running';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_pending_executions(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_automation_pending_executions(INTEGER, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_pending_executions(INTEGER, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.release_automation_pending_execution(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_automation_pending_execution(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_automation_pending_execution(UUID, UUID) TO service_role;
