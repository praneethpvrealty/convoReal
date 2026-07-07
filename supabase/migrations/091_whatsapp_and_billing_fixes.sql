-- ============================================================
-- 091_whatsapp_and_billing_fixes.sql
--
-- Introduces:
--   1. Unique index on messages(message_id) for inbound deduplication.
--   2. Unique index on subscription_events(razorpay_event_id) for audit log deduplication.
--   3. Atomic increment_sandbox_message_count() RPC function.
--   4. reconcile_subscriptions() RPC function.
--   5. Hardened account_plan_limits view.
-- ============================================================

-- 1. Unique index on messages(message_id) for inbound deduplication
DROP INDEX IF EXISTS idx_messages_message_id;
CREATE UNIQUE INDEX idx_messages_message_id ON messages(message_id) WHERE message_id IS NOT NULL;

-- 2. Unique index on subscription_events(razorpay_event_id) for audit log deduplication
DROP INDEX IF EXISTS idx_sub_events_razorpay_event_id;
CREATE UNIQUE INDEX idx_sub_events_razorpay_event_id ON subscription_events(razorpay_event_id) WHERE razorpay_event_id IS NOT NULL;

-- 3. Atomic sandbox message check-and-increment
CREATE OR REPLACE FUNCTION increment_sandbox_message_count(p_account_id UUID, p_limit INT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current INT;
BEGIN
  -- Row-level locking to prevent race conditions during concurrent increments
  SELECT sandbox_message_count INTO v_current
  FROM whatsapp_config
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    v_current := 0;
  END IF;

  IF v_current >= p_limit THEN
    RETURN FALSE;
  END IF;

  UPDATE whatsapp_config
  SET sandbox_message_count = v_current + 1
  WHERE account_id = p_account_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_sandbox_message_count(UUID, INT) TO service_role;

-- 4. Billing reconciliation function
CREATE OR REPLACE FUNCTION reconcile_subscriptions()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 1. Apply scheduled plan downgrades/upgrades whose effective date has passed
  UPDATE subscriptions
  SET
    plan = pending_plan,
    pending_plan = NULL,
    pending_plan_effective_at = NULL,
    updated_at = NOW()
  WHERE pending_plan IS NOT NULL
    AND pending_plan_effective_at <= NOW();

  -- 2. Reset plan to starter for subscriptions that are canceled, past_due, or unpaid
  --    and have passed their current_period_end (with a 12-hour grace period)
  UPDATE subscriptions
  SET
    plan = 'starter',
    updated_at = NOW()
  WHERE plan <> 'starter'
    AND status IN ('canceled', 'past_due', 'unpaid')
    AND current_period_end <= NOW() - INTERVAL '12 hours';
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_subscriptions() TO service_role;

-- 5. Hardened account_plan_limits view
CREATE OR REPLACE VIEW account_plan_limits AS
WITH sub_effective AS (
  SELECT
    account_id,
    status,
    billing_cycle,
    current_period_end,
    pending_plan,
    pending_plan_effective_at,
    CASE
      WHEN status IN ('canceled', 'past_due', 'unpaid') AND current_period_end < NOW() THEN 'starter'
      ELSE COALESCE(plan, 'starter')
    END AS plan
  FROM subscriptions
)
SELECT
  a.id                AS account_id,
  COALESCE(se.plan, 'starter')   AS plan,
  COALESCE(se.status, 'active')  AS status,
  se.billing_cycle,
  se.current_period_end,
  se.pending_plan,
  se.pending_plan_effective_at,

  -- User seats
  CASE COALESCE(se.plan, 'starter')
    WHEN 'starter'  THEN 1
    WHEN 'solo_pro' THEN 1
    WHEN 'team'     THEN 10
    WHEN 'agency'   THEN 999999
    ELSE 1
  END AS max_users,

  -- Contacts
  CASE COALESCE(se.plan, 'starter')
    WHEN 'starter' THEN 50
    ELSE 999999
  END AS max_contacts,

  -- Properties
  CASE COALESCE(se.plan, 'starter')
    WHEN 'starter' THEN 10
    ELSE 999999
  END AS max_properties,

  -- Broadcasts per month (0 = blocked)
  CASE COALESCE(se.plan, 'starter')
    WHEN 'starter'  THEN 0
    WHEN 'solo_pro' THEN 500
    WHEN 'team'     THEN 2000
    WHEN 'agency'   THEN 999999
    ELSE 0
  END AS max_broadcasts_per_month,

  -- Feature flags
  COALESCE(se.plan, 'starter') <> 'starter'           AS has_ai,
  COALESCE(se.plan, 'starter') IN ('team','agency')    AS has_teams,
  COALESCE(se.plan, 'starter') = 'agency'              AS has_multi_number,
  COALESCE(se.plan, 'starter') = 'agency'              AS has_api_access,
  COALESCE(se.plan, 'starter') <> 'starter'            AS has_branded_showcase,
  COALESCE(se.plan, 'starter') = 'agency'              AS has_custom_subdomain

FROM accounts a
LEFT JOIN sub_effective se ON se.account_id = a.id;

GRANT SELECT ON account_plan_limits TO authenticated;
