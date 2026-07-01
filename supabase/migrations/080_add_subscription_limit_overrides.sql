-- ============================================================
-- 080_add_subscription_limit_overrides.sql
-- Per-account overrides for contact/property limits, independent of
-- plan tier. Limits were previously derived purely from `plan` (see
-- account_plan_limits in 073_billing_subscriptions.sql) — there was
-- no way to give one specific account a custom number without
-- bumping every account on that plan.
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS max_contacts_override INTEGER,
  ADD COLUMN IF NOT EXISTS max_properties_override INTEGER;

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

  -- Contacts — per-account override wins when set
  COALESCE(
    s.max_contacts_override,
    CASE COALESCE(s.plan, 'starter')
      WHEN 'starter' THEN 50
      ELSE 999999
    END
  ) AS max_contacts,

  -- Properties — per-account override wins when set
  COALESCE(
    s.max_properties_override,
    CASE COALESCE(s.plan, 'starter')
      WHEN 'starter' THEN 10
      ELSE 999999
    END
  ) AS max_properties,

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

-- Give the "Aryavarta Ventures" account a temporary bump to
-- 5000 contacts / 500 properties while still on the Starter plan
-- (no subscriptions row existed yet for this account).
INSERT INTO subscriptions (account_id, plan, max_contacts_override, max_properties_override)
VALUES ('4f1247de-269c-47c2-8974-36ef8f77f77d', 'starter', 5000, 500)
ON CONFLICT (account_id) DO UPDATE
  SET max_contacts_override = EXCLUDED.max_contacts_override,
      max_properties_override = EXCLUDED.max_properties_override;
