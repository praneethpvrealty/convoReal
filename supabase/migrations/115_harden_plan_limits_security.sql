-- ============================================================
-- 115_harden_plan_limits_security.sql
--
-- Recreates the `account_plan_limits` view with `security_invoker = true`
-- to ensure it respects the querying user's Row-Level Security (RLS)
-- policies rather than running with the view creator's elevated permissions.
-- ============================================================

-- Re-create the view with security_invoker = true
CREATE OR REPLACE VIEW public.account_plan_limits 
WITH (security_invoker = true) AS
SELECT
  a.id                          AS account_id,
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
    WHEN 'starter' THEN 150
    ELSE 999999
  END AS max_contacts,

  -- Properties
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter' THEN 50
    ELSE 999999
  END AS max_properties,

  -- Broadcasts per month (capped at 5,000 for Agency)
  CASE COALESCE(s.plan, 'starter')
    WHEN 'starter'  THEN 0
    WHEN 'solo_pro' THEN 500
    WHEN 'team'     THEN 2000
    WHEN 'agency'   THEN 5000
    ELSE 0
  END AS max_broadcasts_per_month,

  -- Feature flags
  TRUE                                                AS has_ai, -- AI features allowed for everyone (governed by credit engine)
  COALESCE(s.plan, 'starter') IN ('team','agency')    AS has_teams,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_multi_number,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_api_access,
  COALESCE(s.plan, 'starter') <> 'starter'            AS has_branded_showcase,
  COALESCE(s.plan, 'starter') = 'agency'              AS has_custom_subdomain

FROM public.accounts a
LEFT JOIN public.subscriptions s ON s.account_id = a.id;

-- Ensure authenticated role still has select permissions on the view
GRANT SELECT ON public.account_plan_limits TO authenticated;
