-- ============================================================
-- 156_restore_starter_caps.sql — Restore the Starter tier caps to the
-- advertised 150 contacts / 50 properties.
--
-- Migration 116 lowered Starter to 50 contacts / 10 properties, but the
-- pricing config (src/lib/billing/plan-config.ts) and the public pricing
-- page continued to advertise 150 / 50. This restores enforcement to
-- match the promise. Only the Starter rungs change; every other plan's
-- caps and all feature flags are exactly as migration 116 left them.
--
-- Existing rows are never touched — account_plan_limits only gates NEW
-- creates via src/lib/billing/gates.ts (count-and-block on insert).
--
-- Idempotent (CREATE OR REPLACE VIEW) — safe to run multiple times.
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

  -- Contacts (Starter restored 50 -> 150)
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter'  THEN 150
    WHEN 'solo_pro' THEN 1500
    WHEN 'team'     THEN 4500
    WHEN 'agency'   THEN 15000
    ELSE 150
  END AS max_contacts,

  -- Properties (Starter restored 10 -> 50)
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter'  THEN 50
    WHEN 'solo_pro' THEN 500
    WHEN 'team'     THEN 1500
    WHEN 'agency'   THEN 5000
    ELSE 50
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

GRANT SELECT ON account_plan_limits TO authenticated;
