-- ============================================================
-- 085_credit_wallets_and_transactions.sql — Credits & Referral system
--
-- Introduces:
--   1. `credit_wallets`      — one row per account, 5 spendable
--                              buckets + a separate pending-referral
--                              bucket (visible but not spendable
--                              until the referee's 7-day activation
--                              window confirms the referral).
--   2. `credit_transactions` — immutable ledger, source of truth for
--                              every grant/burn/expiry/void.
--
-- Source design: ConvoReal-Engineering-OS/CREDITS_AND_REFERRAL_DESIGN.md
-- Adapted: total_credits is a plain column (not GENERATED ALWAYS),
-- maintained by the SECURITY DEFINER functions in migration 089, so
-- service-role reconciliation stays possible. A CHECK constraint
-- guards against drift instead.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. credit_wallets
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,

  -- Spendable buckets
  monthly_credits    INTEGER NOT NULL DEFAULT 0 CHECK (monthly_credits >= 0),
  bonus_credits      INTEGER NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
  referral_credits   INTEGER NOT NULL DEFAULT 0 CHECK (referral_credits >= 0),
  purchased_credits  INTEGER NOT NULL DEFAULT 0 CHECK (purchased_credits >= 0),
  promo_credits      INTEGER NOT NULL DEFAULT 0 CHECK (promo_credits >= 0),

  -- Referrer signup rewards land here first (visible, not spendable)
  -- until the referee's 7-day activation window promotes them into
  -- referral_credits, or voids them if the referral is invalidated.
  pending_referral_credits INTEGER NOT NULL DEFAULT 0 CHECK (pending_referral_credits >= 0),

  -- Maintained by grant_subscription_credits_tx / burn_credits_tx /
  -- grant_referral_credits_tx (migration 089) — not a generated
  -- column, so support can reconcile it manually if the ledger and
  -- wallet ever drift. Excludes pending_referral_credits by design.
  total_credits INTEGER NOT NULL DEFAULT 0
    CHECK (total_credits = monthly_credits + bonus_credits + referral_credits + purchased_credits + promo_credits),

  referral_code TEXT UNIQUE NOT NULL,
  referral_tier TEXT NOT NULL DEFAULT 'bronze' CHECK (referral_tier IN ('bronze','silver','gold','platinum')),
  paid_referral_count INTEGER NOT NULL DEFAULT 0,

  -- Mirrors subscriptions.current_period_end — next monthly reset date.
  monthly_reset_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON credit_wallets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON credit_wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE credit_wallets ENABLE ROW LEVEL SECURITY;

-- Any team member can see their account's wallet. All writes go
-- through SECURITY DEFINER functions (migration 089) or service-role
-- clients — no direct INSERT/UPDATE policy for `authenticated`,
-- mirroring subscription_events' webhook-only-write convention.
DROP POLICY IF EXISTS wallet_select ON credit_wallets;
CREATE POLICY wallet_select ON credit_wallets FOR SELECT
  USING (is_account_member(account_id));

CREATE INDEX IF NOT EXISTS idx_credit_wallets_referral_code ON credit_wallets(referral_code);

-- ============================================================
-- 2. credit_transactions  (append-only ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (type IN (
    'subscription_grant',   -- monthly cycle grant
    'commitment_bonus',     -- long-term cycle bonus
    'referral_signup',      -- referee signed up / referrer's pending-then-promoted reward
    'referral_upgrade',     -- referee upgraded to paid
    'referral_passive',     -- monthly passive 10%
    'purchase',             -- top-up package bought
    'admin_grant',          -- manager granted to team
    'promo',                -- campaign promo grant
    'ai_burn',              -- AI feature used
    'expiry',               -- credits expired or pending referral voided
    'refund'                -- credits returned on failed AI call
  )),

  bucket TEXT NOT NULL CHECK (bucket IN (
    'monthly','bonus','referral','purchased','promo','pending_referral'
  )),

  amount INTEGER NOT NULL,          -- positive = credit, negative = debit
  balance_after INTEGER NOT NULL,   -- snapshot of total_credits after this tx
                                     -- (pending_referral bucket txs snapshot
                                     -- pending_referral_credits instead)

  description TEXT,
  related_account_id UUID REFERENCES accounts(id),  -- referral counterparty
  ai_feature TEXT,                                    -- for ai_burn

  -- Payment provenance (top-ups only)
  payment_gateway TEXT CHECK (payment_gateway IN ('razorpay','stripe')),
  gateway_payment_id TEXT,   -- razorpay payment_id OR stripe payment_intent id
  gateway_order_id TEXT,     -- razorpay order_id OR stripe checkout session id — idempotency key

  -- Bucket expiry (referral / promo / admin_grant only; NULL = never expires)
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable: no UPDATE or DELETE policy defined below.
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tx_select ON credit_transactions;
CREATE POLICY tx_select ON credit_transactions FOR SELECT
  USING (is_account_member(account_id));
-- No UPDATE/DELETE policy at all, no INSERT policy for authenticated —
-- service-role / SECURITY DEFINER functions only.

CREATE INDEX IF NOT EXISTS idx_credit_tx_account_created ON credit_transactions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_type ON credit_transactions(account_id, type);
CREATE INDEX IF NOT EXISTS idx_credit_tx_gateway_order ON credit_transactions(gateway_order_id) WHERE gateway_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_tx_expiring ON credit_transactions(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================
-- 3. Backfill: every existing account gets a wallet + referral_code.
-- ============================================================
DO $$
DECLARE
  acct RECORD;
  v_code TEXT;
  v_attempts INT;
BEGIN
  FOR acct IN SELECT id, name FROM accounts LOOP
    IF NOT EXISTS (SELECT 1 FROM credit_wallets WHERE account_id = acct.id) THEN
      v_attempts := 0;
      LOOP
        v_code := upper(left(regexp_replace(coalesce(acct.name, 'ACCT'), '[^a-zA-Z]', '', 'g') || 'XXXX', 4))
                  || upper(substr(md5(random()::text || acct.id::text), 1, 3));
        v_attempts := v_attempts + 1;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM credit_wallets WHERE referral_code = v_code) OR v_attempts > 10;
      END LOOP;
      INSERT INTO credit_wallets (account_id, referral_code)
      VALUES (acct.id, v_code)
      ON CONFLICT (account_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;
