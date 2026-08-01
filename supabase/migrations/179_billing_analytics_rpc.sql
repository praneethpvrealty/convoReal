-- ============================================================
-- 179_billing_analytics_rpc.sql
-- Platform-wide subscription & billing analytics in one round trip.
--
-- The admin control center previously showed only raw account/user
-- counts; every billing table (subscriptions, subscription_events,
-- razorpay_orders, credit_transactions) was written by webhooks and
-- API routes but never aggregated for reporting.
--
-- billing_analytics() returns one JSONB document:
--   plans         — accounts grouped by effective plan, billing cycle
--                   and status (accounts without a subscriptions row
--                   count as 'starter'/'active', matching the
--                   account_plan_limits view). MRR is computed in
--                   application code from these counts and the plan
--                   prices in src/lib/billing/plan-config.ts.
--   monthly       — per calendar month (last p_months, empty months
--                   included): new accounts, upgrades, downgrades,
--                   cancellations, successful payments, subscription
--                   revenue (paise, from payment_succeeded event
--                   metadata), paid credit top-up revenue (paise,
--                   Razorpay orders), credits purchased and AI
--                   credits burned (credit units — Stripe top-ups
--                   store no monetary amount locally).
--   recent_events — latest 20 subscription events with account names.
--
-- Cross-tenant by design: no account parameter, no is_account_member
-- guard. EXECUTE is revoked from anon/authenticated and granted only
-- to service_role; the sole caller is /api/admin/billing-analytics,
-- which verifies profiles.role = 'super_admin' before invoking it.
-- ============================================================

-- Platform-wide time-bucketed scans (existing indexes lead with account_id).
CREATE INDEX IF NOT EXISTS idx_sub_events_created
  ON subscription_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_type_created
  ON credit_transactions(type, created_at);

CREATE OR REPLACE FUNCTION public.billing_analytics(p_months INT DEFAULT 12)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH months AS (
  SELECT date_trunc('month', now()) - make_interval(months => n) AS month_start
  FROM generate_series(GREATEST(p_months, 1) - 1, 0, -1) AS n
),
plan_rows AS (
  SELECT
    COALESCE(s.plan, 'starter')   AS plan,
    s.billing_cycle,
    COALESCE(s.status, 'active')  AS status,
    count(*)                      AS accounts
  FROM accounts a
  LEFT JOIN subscriptions s ON s.account_id = a.id
  GROUP BY 1, 2, 3
),
monthly AS (
  SELECT
    to_char(m.month_start, 'YYYY-MM') AS month,
    (SELECT count(*) FROM accounts a
      WHERE a.created_at >= m.month_start
        AND a.created_at < m.month_start + interval '1 month') AS new_accounts,
    (SELECT count(*) FROM subscription_events e
      WHERE e.event_type = 'upgraded'
        AND e.created_at >= m.month_start
        AND e.created_at < m.month_start + interval '1 month') AS upgrades,
    (SELECT count(*) FROM subscription_events e
      WHERE e.event_type = 'downgraded'
        AND e.created_at >= m.month_start
        AND e.created_at < m.month_start + interval '1 month') AS downgrades,
    (SELECT count(*) FROM subscription_events e
      WHERE e.event_type = 'canceled'
        AND e.created_at >= m.month_start
        AND e.created_at < m.month_start + interval '1 month') AS cancellations,
    (SELECT count(*) FROM subscription_events e
      WHERE e.event_type = 'payment_succeeded'
        AND e.created_at >= m.month_start
        AND e.created_at < m.month_start + interval '1 month') AS payments,
    (SELECT COALESCE(sum((e.metadata->>'amount')::numeric), 0)
       FROM subscription_events e
      WHERE e.event_type = 'payment_succeeded'
        AND e.metadata ? 'amount'
        AND e.created_at >= m.month_start
        AND e.created_at < m.month_start + interval '1 month') AS subscription_revenue_paise,
    (SELECT COALESCE(sum(o.amount), 0) FROM razorpay_orders o
      WHERE o.status = 'paid'
        AND o.created_at >= m.month_start
        AND o.created_at < m.month_start + interval '1 month') AS topup_revenue_paise,
    (SELECT COALESCE(sum(t.amount), 0) FROM credit_transactions t
      WHERE t.type = 'purchase'
        AND t.created_at >= m.month_start
        AND t.created_at < m.month_start + interval '1 month') AS credits_purchased,
    (SELECT COALESCE(sum(abs(t.amount)), 0) FROM credit_transactions t
      WHERE t.type = 'ai_burn'
        AND t.created_at >= m.month_start
        AND t.created_at < m.month_start + interval '1 month') AS ai_credits_burned
  FROM months m
),
recent AS (
  SELECT e.id, e.event_type, e.from_plan, e.to_plan, e.created_at,
         a.name AS account_name
  FROM subscription_events e
  JOIN accounts a ON a.id = e.account_id
  ORDER BY e.created_at DESC
  LIMIT 20
)
SELECT jsonb_build_object(
  'plans',
    (SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM plan_rows p),
  'monthly',
    (SELECT COALESCE(jsonb_agg(to_jsonb(mo) ORDER BY mo.month), '[]'::jsonb) FROM monthly mo),
  'recent_events',
    (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb) FROM recent r)
);
$$;

COMMENT ON FUNCTION public.billing_analytics(INT) IS
  'Platform-wide billing analytics document (plan breakdown, monthly revenue/plan-movement series, recent subscription events). service_role only — called by the super_admin-gated /api/admin/billing-analytics route.';

REVOKE ALL ON FUNCTION public.billing_analytics(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_analytics(INT) FROM anon;
REVOKE ALL ON FUNCTION public.billing_analytics(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.billing_analytics(INT) TO service_role;
