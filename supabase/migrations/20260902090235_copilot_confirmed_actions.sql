CREATE TABLE IF NOT EXISTS public.copilot_action_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  action_type TEXT NOT NULL CHECK (action_type IN ('complete_event')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('appointment')),
  entity_id UUID NOT NULL,
  source_platform TEXT NOT NULL CHECK (source_platform IN ('web', 'mobile')),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'already_completed')),
  before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copilot_action_executions_account_created
  ON public.copilot_action_executions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_copilot_action_executions_entity
  ON public.copilot_action_executions (
    account_id,
    entity_type,
    entity_id,
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_copilot_action_executions_actor
  ON public.copilot_action_executions (actor_user_id)
  WHERE actor_user_id IS NOT NULL;

ALTER TABLE public.copilot_action_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_action_executions_select
  ON public.copilot_action_executions;
CREATE POLICY copilot_action_executions_select
  ON public.copilot_action_executions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND public.is_account_member(account_id)
  );

REVOKE ALL ON TABLE public.copilot_action_executions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.copilot_action_executions
  TO authenticated, service_role;

DROP POLICY IF EXISTS appointments_insert ON public.appointments;
CREATE POLICY appointments_insert
  ON public.appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND public.is_account_member(
      account_id,
      'agent'::public.account_role_enum
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.account_id = appointments.account_id
        AND p.is_read_only IS NOT TRUE
    )
  );

DROP POLICY IF EXISTS appointments_update ON public.appointments;
CREATE POLICY appointments_update
  ON public.appointments
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND public.is_account_member(
      account_id,
      'agent'::public.account_role_enum
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.account_id = appointments.account_id
        AND p.is_read_only IS NOT TRUE
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND public.is_account_member(
      account_id,
      'agent'::public.account_role_enum
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.account_id = appointments.account_id
        AND p.is_read_only IS NOT TRUE
    )
  );

DROP POLICY IF EXISTS appointments_delete ON public.appointments;
CREATE POLICY appointments_delete
  ON public.appointments
  FOR DELETE
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND public.is_account_member(
      account_id,
      'agent'::public.account_role_enum
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.account_id = appointments.account_id
        AND p.is_read_only IS NOT TRUE
    )
  );

REVOKE ALL ON TABLE public.appointments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appointments
  TO authenticated;

-- SECURITY DEFINER is intentional: authenticated clients can read this ledger
-- but cannot forge, update, or delete entries. The function exposes one fixed
-- transition, rejects read-only profiles, scopes the locked row through
-- is_account_member(), uses an empty search_path, and is executable only by
-- authenticated users.
CREATE OR REPLACE FUNCTION public.complete_copilot_appointment(
  p_appointment_id UUID,
  p_idempotency_key UUID,
  p_platform TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_appointment public.appointments%ROWTYPE;
  v_execution public.copilot_action_executions%ROWTYPE;
  v_is_read_only BOOLEAN;
  v_outcome TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT p.is_read_only
  INTO v_is_read_only
  FROM public.profiles AS p
  WHERE p.user_id = v_actor;

  IF NOT FOUND OR v_is_read_only IS NOT FALSE THEN
    RAISE EXCEPTION 'Read-only members cannot execute Copilot actions'
      USING ERRCODE = '42501';
  END IF;

  IF p_platform NOT IN ('web', 'mobile') THEN
    RAISE EXCEPTION 'Unsupported source platform' USING ERRCODE = '22023';
  END IF;

  -- Resolve a successful retry before touching the source row. The audit row
  -- deliberately has no appointment FK, so a confirmed result remains
  -- replayable after the appointment is deleted. Membership is still checked
  -- before returning any tenant data.
  SELECT *
  INTO v_execution
  FROM public.copilot_action_executions
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF public.is_account_member(
      v_execution.account_id,
      'agent'::public.account_role_enum
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Calendar event not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_execution.action_type IS DISTINCT FROM 'complete_event'
      OR v_execution.entity_type IS DISTINCT FROM 'appointment'
      OR v_execution.entity_id IS DISTINCT FROM p_appointment_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for another action'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'action_id', p_idempotency_key,
      'entity_id', p_appointment_id,
      'status', COALESCE(v_execution.after_state ->> 'status', 'completed'),
      'outcome', v_execution.outcome,
      'replayed', TRUE,
      'executed_at', v_execution.created_at
    );
  END IF;

  SELECT *
  INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id
    AND public.is_account_member(
      account_id,
      'agent'::public.account_role_enum
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar event not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_appointment.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled calendar events cannot be completed'
      USING ERRCODE = 'P0001';
  END IF;

  v_outcome := CASE
    WHEN v_appointment.status = 'completed' THEN 'already_completed'
    ELSE 'applied'
  END;

  INSERT INTO public.copilot_action_executions (
    account_id,
    actor_user_id,
    idempotency_key,
    action_type,
    entity_type,
    entity_id,
    source_platform,
    outcome,
    before_state,
    after_state
  )
  VALUES (
    v_appointment.account_id,
    v_actor,
    p_idempotency_key,
    'complete_event',
    'appointment',
    v_appointment.id,
    p_platform,
    v_outcome,
    jsonb_build_object(
      'status', v_appointment.status,
      'updated_at', v_appointment.updated_at
    ),
    jsonb_build_object('status', 'completed')
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_execution;

  IF v_execution.id IS NULL THEN
    SELECT *
    INTO v_execution
    FROM public.copilot_action_executions
    WHERE idempotency_key = p_idempotency_key;

    IF public.is_account_member(
      v_execution.account_id,
      'agent'::public.account_role_enum
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Calendar event not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_execution.account_id IS DISTINCT FROM v_appointment.account_id
      OR v_execution.action_type IS DISTINCT FROM 'complete_event'
      OR v_execution.entity_type IS DISTINCT FROM 'appointment'
      OR v_execution.entity_id IS DISTINCT FROM p_appointment_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for another action'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'action_id', p_idempotency_key,
      'entity_id', p_appointment_id,
      'status', COALESCE(v_execution.after_state ->> 'status', 'completed'),
      'outcome', v_execution.outcome,
      'replayed', TRUE,
      'executed_at', v_execution.created_at
    );
  END IF;

  IF v_appointment.status = 'scheduled' THEN
    UPDATE public.appointments
    SET status = 'completed'
    WHERE id = v_appointment.id
      AND account_id = v_appointment.account_id
      AND status = 'scheduled'
    RETURNING * INTO v_appointment;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Calendar event changed before completion'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'action_id', p_idempotency_key,
    'entity_id', p_appointment_id,
    'status', 'completed',
    'outcome', v_outcome,
    'replayed', FALSE,
    'executed_at', v_execution.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_copilot_appointment(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_copilot_appointment(UUID, UUID, TEXT)
  TO authenticated;
