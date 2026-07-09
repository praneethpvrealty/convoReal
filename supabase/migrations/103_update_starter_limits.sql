-- ============================================================
-- 103_update_starter_limits.sql — Update Starter plan limits
--   - Set default Starter monthly credits to 100
--   - Increase contact cap to 150
--   - Increase property cap to 50
--   - Permit AI access on all plans (governed by credit balance)
--   - Cap Agency broadcasts to 5,000 to prevent margin loss
-- ============================================================

-- Update defaults for newly created wallets
ALTER TABLE public.credit_wallets
  ALTER COLUMN monthly_credits SET DEFAULT 100,
  ALTER COLUMN total_credits SET DEFAULT 100;

-- Update existing credit wallets for Starter users that have 0 credits
UPDATE public.credit_wallets cw
SET monthly_credits = 100,
    total_credits = 100 + cw.bonus_credits + cw.referral_credits + cw.purchased_credits + cw.promo_credits
FROM public.subscriptions s
WHERE s.account_id = cw.account_id AND s.plan = 'starter' AND cw.monthly_credits = 0;

-- Update existing credit wallets for accounts without a subscription row (defaults to starter)
UPDATE public.credit_wallets cw
SET monthly_credits = 100,
    total_credits = 100 + cw.bonus_credits + cw.referral_credits + cw.purchased_credits + cw.promo_credits
WHERE cw.monthly_credits = 0 AND NOT EXISTS (
  SELECT 1 FROM public.subscriptions WHERE account_id = cw.account_id
);

-- Alter subscription billing cycle constraint to include 'quarterly'
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_billing_cycle_check CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual'));

-- Re-create the view with the updated rules
CREATE OR REPLACE VIEW public.account_plan_limits AS
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
