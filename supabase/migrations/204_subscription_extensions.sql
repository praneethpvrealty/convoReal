-- ============================================================
-- 204_subscription_extensions.sql — Admin-granted subscription
-- extensions (service credit for outages and other operator-caused
-- disruption).
--
-- WHY A LEDGER AND NOT `subscriptions.current_period_end += N days`:
-- current_period_end is a MIRROR of the gateway's own period, and the
-- Razorpay webhook overwrites it verbatim on every
-- subscription.activated / subscription.charged event
-- (src/app/api/billing/razorpay-webhook/route.ts). A direct bump would
-- be silently erased at the next renewal, with nothing left to show a
-- credit was ever granted. Extensions therefore live in their own
-- append-only ledger and are layered on top of the mirrored date by
-- the account_plan_limits view.
--
-- WHY `extended_until` AND NOT JUST `days`:
-- a grant is a ONE-TIME credit, not a permanent shift. Storing the
-- absolute deadline and taking GREATEST(current_period_end,
-- extended_until) means the credit stops mattering the moment the
-- gateway's own period naturally overtakes it — a 7-day outage credit
-- can never turn into 7 free days on every future cycle. `days` is
-- retained alongside it for the audit trail and the UI.
--
-- Security posture: writes are service-role only, from the super-admin
-- routes under /api/admin/subscription-extensions, each gated by the
-- same WhatsApp OTP step-up as the plan override (115). Account owners
-- get SELECT on their own rows so the credit is visible to the
-- customer it was granted to, matching the RLS on `subscriptions`.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. subscription_extensions (append-only, revoke via revoked_at)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_extensions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  days             INT NOT NULL CHECK (days > 0 AND days <= 90),
  -- Absolute deadline this grant buys: GREATEST(current_period_end, now()) + days,
  -- snapshotted at grant time. The view reads this, not `days`.
  extended_until   TIMESTAMPTZ NOT NULL,
  -- The period end this was granted against, for "what did it actually move" audits.
  period_end_before TIMESTAMPTZ,

  reason           TEXT NOT NULL CHECK (reason IN (
                     'outage','degraded_service','billing_error',
                     'onboarding_delay','support_goodwill'
                   )),
  -- Internal only. Terse operator shorthand ("WhatsApp sends failing, 3h")
  -- that must never be shown to the customer.
  note             TEXT,
  -- Customer-facing. Optional override for the canned empathetic line
  -- keyed off `reason`; part of the OTP payload hash, so the admin
  -- verifies the exact words the customer will read.
  customer_message TEXT,
  -- Groups every row written by one bulk grant, so a whole incident can
  -- be listed and revoked as a unit. NULL for one-off single-account grants.
  incident_ref     TEXT,

  -- Outcome of the apology/goodwill fan-out (WhatsApp + email + in-app).
  -- Best-effort delivery: a grant is never rolled back because a channel
  -- failed, but the failure has to be visible so it can be chased.
  notified_at      TIMESTAMPTZ,
  notification_result JSONB,

  granted_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_by_email TEXT,          -- snapshot; survives the admin's auth row being deleted

  revoked_at       TIMESTAMPTZ,
  revoked_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoke_reason    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscription_extensions ENABLE ROW LEVEL SECURITY;

-- Owners see credits granted to their own account — same visibility rule
-- as the subscriptions row this modifies. No INSERT/UPDATE/DELETE
-- policies: only the service-role admin routes write here.
DROP POLICY IF EXISTS subscription_extensions_select ON subscription_extensions;
CREATE POLICY subscription_extensions_select ON subscription_extensions FOR SELECT
  USING (is_account_member(account_id, 'owner'));

CREATE INDEX IF NOT EXISTS idx_subscription_extensions_account
  ON subscription_extensions (account_id, created_at DESC);
-- Partial index backing the view's correlated MAX() — only live grants matter.
CREATE INDEX IF NOT EXISTS idx_subscription_extensions_active
  ON subscription_extensions (account_id, extended_until DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subscription_extensions_incident
  ON subscription_extensions (incident_ref, created_at DESC)
  WHERE incident_ref IS NOT NULL;

-- ============================================================
-- 2. admin_plan_otp_challenges — generalize beyond plan changes
--
-- 115 built this table for one action (plan override). Extensions need
-- exactly the same step-up guarantees (hashed at rest, single-use,
-- expiring, attempt-capped, bound to the acting admin), so the table is
-- widened rather than duplicated.
--
-- `payload_hash` is the binding for actions whose subject is not a
-- (from_plan -> to_plan) pair: a SHA-256 of the canonical serialization
-- of the requested change (see hashExtensionPayload in
-- src/lib/billing/admin-extension.ts). A code issued for "3 days to
-- account X" therefore cannot be replayed to apply "90 days to every
-- account" — the hash won't match.
-- ============================================================
ALTER TABLE admin_plan_otp_challenges
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'plan_change';

ALTER TABLE admin_plan_otp_challenges
  ADD COLUMN IF NOT EXISTS payload_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_plan_otp_challenges_action_check'
  ) THEN
    ALTER TABLE admin_plan_otp_challenges
      ADD CONSTRAINT admin_plan_otp_challenges_action_check
      CHECK (action IN ('plan_change','extension_grant','extension_revoke'));
  END IF;
END $$;

-- from_plan/to_plan are meaningless for extension challenges. They stay
-- NOT NULL for plan_change via the constraint below rather than at the
-- column level, so the plan path keeps its guarantee.
ALTER TABLE admin_plan_otp_challenges ALTER COLUMN from_plan DROP NOT NULL;
ALTER TABLE admin_plan_otp_challenges ALTER COLUMN to_plan   DROP NOT NULL;
-- account_id is per-row for a plan change but meaningless for a bulk
-- extension spanning many accounts (the account set is bound by
-- payload_hash instead).
ALTER TABLE admin_plan_otp_challenges ALTER COLUMN account_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_plan_otp_challenges_binding_check'
  ) THEN
    ALTER TABLE admin_plan_otp_challenges
      ADD CONSTRAINT admin_plan_otp_challenges_binding_check
      CHECK (
        (action = 'plan_change'
          AND account_id IS NOT NULL AND from_plan IS NOT NULL AND to_plan IS NOT NULL)
        OR
        (action <> 'plan_change' AND payload_hash IS NOT NULL)
      );
  END IF;
END $$;

-- ============================================================
-- 3. account_plan_limits — layer active extensions onto the mirrored
--    period end.
--
-- Body is 116_update_plan_caps.sql verbatim with two columns APPENDED
-- (CREATE OR REPLACE VIEW can add trailing columns but never reorder or
-- retype existing ones). Nothing about plan gating changes here.
--
-- GREATEST ignores NULLs in PostgreSQL, so a starter account with no
-- current_period_end and no extensions still yields NULL, and an
-- extension on such an account still surfaces its own deadline.
--
-- BOTH subqueries filter on `extended_until > NOW()` — only credit still
-- in force may move anything. Filtering just the SUM would leave an
-- expired grant contributing to the MAX, and on an account with no
-- gateway period at all (GREATEST(NULL, ...) collapses to the credit
-- deadline) that would surface a date in the PAST as the account's
-- renewal date. Verified against production, where every subscription
-- currently has a NULL current_period_end.
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
    WHEN 'team'     THEN 3
    WHEN 'agency'   THEN 10
    ELSE 1
  END AS max_users,

  -- Contacts
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter'  THEN 50
    WHEN 'solo_pro' THEN 1500
    WHEN 'team'     THEN 4500
    WHEN 'agency'   THEN 15000
    ELSE 50
  END AS max_contacts,

  -- Properties
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter'  THEN 10
    WHEN 'solo_pro' THEN 500
    WHEN 'team'     THEN 1500
    WHEN 'agency'   THEN 5000
    ELSE 10
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
  COALESCE(s.plan, 'starter') = 'agency'              AS has_custom_subdomain,

  -- Admin-granted service credit still in force (204).
  COALESCE((
    SELECT SUM(e.days)::INT
    FROM subscription_extensions e
    WHERE e.account_id = a.id
      AND e.revoked_at IS NULL
      AND e.extended_until > NOW()
  ), 0) AS extension_days,

  -- What the customer should be told their access actually runs to.
  GREATEST(
    s.current_period_end,
    (SELECT MAX(e.extended_until)
       FROM subscription_extensions e
      WHERE e.account_id = a.id
        AND e.revoked_at IS NULL
        AND e.extended_until > NOW())
  ) AS effective_period_end

FROM accounts a
LEFT JOIN subscriptions s ON s.account_id = a.id;

GRANT SELECT ON account_plan_limits TO authenticated;
