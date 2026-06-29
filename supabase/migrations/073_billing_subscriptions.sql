-- ============================================================
-- 073_billing_subscriptions.sql — Subscription & plan gating
--
-- Introduces:
--   1. `subscriptions`        — one row per account, Razorpay-backed
--   2. `subscription_events`  — immutable audit log of plan changes
--   3. `account_plan_limits`  — view: effective limits per account
--
-- Existing accounts without a row in `subscriptions` are treated as
-- 'starter' by the view via LEFT JOIN — no backfill required.
--
-- Role mapping: 'owner' in account_role_enum = org_manager in the
-- billing design doc. Only owners may read/write subscription rows.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  plan                      TEXT NOT NULL DEFAULT 'starter'
                              CHECK (plan IN ('starter','solo_pro','team','agency')),
  billing_cycle             TEXT CHECK (billing_cycle IN ('monthly','annual')),
  status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN (
                                'active','trialing','past_due','canceled','grace_period'
                              )),

  -- Razorpay references (NULL for Starter / not-yet-subscribed)
  razorpay_subscription_id  TEXT UNIQUE,
  razorpay_customer_id      TEXT,
  razorpay_plan_id          TEXT,

  current_period_start      TIMESTAMPTZ,
  current_period_end        TIMESTAMPTZ,

  -- Scheduled downgrade: set when user requests a plan reduction
  pending_plan              TEXT CHECK (pending_plan IN ('starter','solo_pro','team','agency')),
  pending_plan_effective_at TIMESTAMPTZ,

  trial_ends_at             TIMESTAMPTZ,
  canceled_at               TIMESTAMPTZ,

  -- Billing currency / gateway (detected at account creation from phone country code)
  billing_currency          TEXT NOT NULL DEFAULT 'INR',
  billing_gateway           TEXT NOT NULL DEFAULT 'razorpay'
                              CHECK (billing_gateway IN ('razorpay','stripe')),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(account_id)
);

DROP TRIGGER IF EXISTS set_updated_at ON subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Only the account owner may read or write their subscription row.
DROP POLICY IF EXISTS subscriptions_select ON subscriptions;
DROP POLICY IF EXISTS subscriptions_insert ON subscriptions;
DROP POLICY IF EXISTS subscriptions_update ON subscriptions;
CREATE POLICY subscriptions_select ON subscriptions FOR SELECT
  USING (is_account_member(account_id, 'owner'));
CREATE POLICY subscriptions_insert ON subscriptions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'owner'));
CREATE POLICY subscriptions_update ON subscriptions FOR UPDATE
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));
-- No DELETE: webhook upserts handle state transitions.

CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay ON subscriptions(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

-- ============================================================
-- 2. subscription_events  (append-only audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,   -- 'upgraded','downgraded','canceled','payment_failed','payment_succeeded','trial_started'
  from_plan         TEXT,
  to_plan           TEXT,
  razorpay_event_id TEXT,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable: no UPDATE or DELETE
);

CREATE INDEX IF NOT EXISTS idx_sub_events_account ON subscription_events(account_id, created_at DESC);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_events_select ON subscription_events;
CREATE POLICY sub_events_select ON subscription_events FOR SELECT
  USING (is_account_member(account_id, 'owner'));
-- Inserts are service-role only (webhook handler, API routes via admin client).

-- ============================================================
-- 3. account_plan_limits  (view — no storage)
--
-- Accounts without a subscriptions row default to 'starter'.
-- This view is the single source of truth for feature gating.
-- ============================================================
CREATE OR REPLACE VIEW account_plan_limits AS
SELECT
  a.id                AS account_id,
  COALESCE(s.plan, 'starter')   AS plan,
  COALESCE(s.status, 'active')  AS status,
  s.billing_cycle,
  s.current_period_end,
  s.pending_plan,
  s.pending_plan_effective_at,

  -- User seats
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter'  THEN 1
    WHEN 'solo_pro' THEN 1
    WHEN 'team'     THEN 10
    WHEN 'agency'   THEN 999999
    ELSE 1
  END AS max_users,

  -- Contacts
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter' THEN 50
    ELSE 999999
  END AS max_contacts,

  -- Properties
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter' THEN 10
    ELSE 999999
  END AS max_properties,

  -- Broadcasts per month (0 = blocked)
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter'  THEN 0
    WHEN 'solo_pro' THEN 500
    WHEN 'team'     THEN 2000
    WHEN 'agency'   THEN 999999
    ELSE 0
  END AS max_broadcasts_per_month,

  -- Feature flags
  COALESCE(s.plan, 'starter') <> 'starter'           AS has_ai,
  COALESCE(s.plan, 'starter') IN ('team','agency')    AS has_teams,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_multi_number,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_api_access,
  COALESCE(s.plan, 'starter') <> 'starter'            AS has_branded_showcase,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_custom_subdomain

FROM accounts a
LEFT JOIN subscriptions s ON s.account_id = a.id;

-- Grant access to authenticated users so client hooks can read it
-- (the underlying RLS on subscriptions still governs write access).
GRANT SELECT ON account_plan_limits TO authenticated;
