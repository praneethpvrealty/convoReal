-- ============================================================
-- 116_update_plan_caps.sql — Real per-plan caps for Solo Pro / Team /
-- Agency (previously "unlimited" contacts/properties, and unlimited
-- users on Agency).
--
-- Solo Pro: 1,500 contacts / 500 properties (users unchanged at 1)
-- Team:     3 users (was 10) / 4,500 contacts / 1,500 properties
-- Agency:   10 users (was unlimited) / 15,000 contacts / 5,000 properties
--
-- No grandfathering: confirmed no existing customers on Team/Agency at
-- the time of this migration, so this is a straight cap change. Existing
-- rows are never touched by this — account_plan_limits only gates NEW
-- creates via src/lib/billing/gates.ts (count-and-block on insert).
--
-- max_broadcasts_per_month is intentionally left untouched.
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

  -- Broadcasts per month (0 = blocked) — unchanged by this migration
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter'  THEN 0
    WHEN 'solo_pro' THEN 500
    WHEN 'team'     THEN 2000
    WHEN 'agency'   THEN 999999
    ELSE 0
  END AS max_broadcasts_per_month,

  -- Feature flags — unchanged by this migration
  COALESCE(s.plan, 'starter') <> 'starter'           AS has_ai,
  COALESCE(s.plan, 'starter') IN ('team','agency')    AS has_teams,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_multi_number,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_api_access,
  COALESCE(s.plan, 'starter') <> 'starter'            AS has_branded_showcase,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_custom_subdomain

FROM accounts a
LEFT JOIN subscriptions s ON s.account_id = a.id;

GRANT SELECT ON account_plan_limits TO authenticated;
