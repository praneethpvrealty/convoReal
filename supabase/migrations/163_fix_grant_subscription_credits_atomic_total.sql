-- ============================================================
-- 163_fix_grant_subscription_credits_atomic_total.sql
--
-- BUG (same class 097 fixed, but this function was missed there):
-- grant_subscription_credits_tx (089_credit_engine_functions.sql)
-- mutates bucket columns in ONE statement and sets total_credits in a
-- SEPARATE statement:
--
--     UPDATE credit_wallets SET monthly_credits = …, bonus_credits = …;  -- (1)
--     UPDATE credit_wallets SET total_credits   = …;                     -- (2)
--
-- credit_wallets carries a NON-deferrable CHECK (migration 085):
--     total_credits = monthly + bonus + referral + purchased + promo
--
-- CHECK constraints run at the end of EVERY statement, so after (1) the
-- row is transiently inconsistent (buckets changed, total not) and the
-- constraint fires:
--     "new row for relation credit_wallets violates check constraint
--      credit_wallets_check"
--
-- The grant aborts. It's invoked from every plan activation/upgrade path
-- (create-subscription, upgrade, razorpay-webhook, admin plan override).
-- Those callers wrap the call in .catch()/log, so the plan change still
-- lands but the account never receives its subscription credits.
-- Migration 097 folded burn/purchase/refund into single UPDATEs; this
-- grant function was not included.
--
-- FIX: set the buckets AND total_credits in a SINGLE UPDATE so the row is
-- consistent at the statement boundary. No behavioural change beyond "it
-- now succeeds" — delta math, ledger rows, and the return value are
-- preserved verbatim.
--
-- Idempotent — CREATE OR REPLACE, safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION grant_subscription_credits_tx(
  p_account_id UUID,
  p_monthly_amount INT,
  p_bonus_delta INT,
  p_reset_at TIMESTAMPTZ
) RETURNS TABLE(balance_after INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w credit_wallets%ROWTYPE;
  v_monthly_delta INT;
  v_new_total INT;
BEGIN
  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  v_monthly_delta := p_monthly_amount - w.monthly_credits;
  v_new_total := p_monthly_amount + (w.bonus_credits + p_bonus_delta)
    + w.referral_credits + w.purchased_credits + w.promo_credits;

  -- Buckets AND total in one statement — keeps total_credits = sum(buckets)
  -- true at the statement boundary the non-deferrable CHECK is evaluated on.
  UPDATE credit_wallets SET
    monthly_credits = p_monthly_amount,
    bonus_credits = bonus_credits + p_bonus_delta,
    monthly_reset_at = p_reset_at,
    total_credits = v_new_total
  WHERE account_id = p_account_id;

  IF v_monthly_delta <> 0 THEN
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, description)
    VALUES (p_account_id, 'subscription_grant', 'monthly', v_monthly_delta, v_new_total, 'Monthly credit grant reset');
  END IF;

  IF p_bonus_delta <> 0 THEN
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, description)
    VALUES (p_account_id, 'commitment_bonus', 'bonus', p_bonus_delta, v_new_total, 'Commitment bonus for long-term cycle');
  END IF;

  RETURN QUERY SELECT v_new_total;
END;
$$;
