-- ============================================================
-- 089_credit_engine_functions.sql — Credit engine atomic operations
--
-- All credit_wallets mutations happen inside SECURITY DEFINER
-- functions so the read-check-deduct-insert sequence is one atomic
-- statement (SELECT ... FOR UPDATE) — this avoids a race between two
-- concurrent AI calls on the same account both reading a stale
-- balance and double-spending the last few credits.
--
-- burn_credits_tx is granted to `authenticated` (called from
-- user-session routes via ctx.supabase.rpc(...)). The grant/referral
-- functions are granted to `service_role` only (called exclusively
-- from webhook/cron code via billingAdmin()).
--
-- Source design: ConvoReal-Engineering-OS/CREDITS_AND_REFERRAL_DESIGN.md §9
-- ============================================================

-- ============================================================
-- 1. burn_credits_tx
-- ============================================================
CREATE OR REPLACE FUNCTION burn_credits_tx(
  p_account_id UUID,
  p_feature TEXT,
  p_cost INT,
  p_hard_block BOOLEAN,
  p_retry_key TEXT DEFAULT NULL
) RETURNS TABLE(success BOOLEAN, balance_after INT, deficit INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w credit_wallets%ROWTYPE;
  remaining INT;
  take INT;
  v_new_total INT;
  v_description TEXT;
  v_existing_tx RECORD;
BEGIN
  -- Idempotency: a retry of the same request within 60s is free.
  IF p_retry_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx
    FROM credit_transactions
    WHERE account_id = p_account_id
      AND ai_feature = p_feature
      AND description = 'retry:' || p_retry_key
      AND created_at > NOW() - INTERVAL '60 seconds'
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN QUERY SELECT TRUE, v_existing_tx.balance_after, 0;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, p_cost;
    RETURN;
  END IF;

  IF p_hard_block AND w.total_credits < p_cost THEN
    RETURN QUERY SELECT FALSE, w.total_credits, (p_cost - w.total_credits);
    RETURN;
  END IF;

  v_description := CASE WHEN p_retry_key IS NOT NULL THEN 'retry:' || p_retry_key ELSE p_feature || ' burn' END;
  remaining := p_cost;

  -- Bucket priority: monthly -> bonus -> referral -> purchased -> promo.
  -- One ledger row per bucket actually touched, so the breakdown
  -- page's per-bucket filter reflects reality.
  take := LEAST(remaining, w.monthly_credits);
  IF take > 0 THEN
    w.monthly_credits := w.monthly_credits - take;
    remaining := remaining - take;
    UPDATE credit_wallets SET monthly_credits = w.monthly_credits WHERE account_id = p_account_id;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'monthly', -take, v_new_total, p_feature, v_description);
  END IF;

  take := LEAST(remaining, w.bonus_credits);
  IF take > 0 THEN
    w.bonus_credits := w.bonus_credits - take;
    remaining := remaining - take;
    UPDATE credit_wallets SET bonus_credits = w.bonus_credits WHERE account_id = p_account_id;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'bonus', -take, v_new_total, p_feature, v_description);
  END IF;

  take := LEAST(remaining, w.referral_credits);
  IF take > 0 THEN
    w.referral_credits := w.referral_credits - take;
    remaining := remaining - take;
    UPDATE credit_wallets SET referral_credits = w.referral_credits WHERE account_id = p_account_id;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'referral', -take, v_new_total, p_feature, v_description);
  END IF;

  take := LEAST(remaining, w.purchased_credits);
  IF take > 0 THEN
    w.purchased_credits := w.purchased_credits - take;
    remaining := remaining - take;
    UPDATE credit_wallets SET purchased_credits = w.purchased_credits WHERE account_id = p_account_id;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'purchased', -take, v_new_total, p_feature, v_description);
  END IF;

  take := LEAST(remaining, w.promo_credits);
  IF take > 0 THEN
    w.promo_credits := w.promo_credits - take;
    remaining := remaining - take;
    UPDATE credit_wallets SET promo_credits = w.promo_credits WHERE account_id = p_account_id;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'promo', -take, v_new_total, p_feature, v_description);
  END IF;

  -- remaining > 0 here only in the soft-block (hard_block = false)
  -- underflow case — nothing further to deduct, caller proceeds anyway.
  v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
  RETURN QUERY SELECT TRUE, v_new_total, remaining;
END;
$$;

GRANT EXECUTE ON FUNCTION burn_credits_tx(UUID, TEXT, INT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION burn_credits_tx(UUID, TEXT, INT, BOOLEAN, TEXT) TO service_role;

-- ============================================================
-- 2. grant_subscription_credits_tx
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

  UPDATE credit_wallets SET
    monthly_credits = p_monthly_amount,
    bonus_credits = bonus_credits + p_bonus_delta,
    monthly_reset_at = p_reset_at
  WHERE account_id = p_account_id;

  v_new_total := p_monthly_amount + (w.bonus_credits + p_bonus_delta) + w.referral_credits + w.purchased_credits + w.promo_credits;
  UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;

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

GRANT EXECUTE ON FUNCTION grant_subscription_credits_tx(UUID, INT, INT, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- 3. grant_referral_credits_tx — generic spendable-bucket grant
--    (referee welcome bonus, referrer conversion bonus, passive earn)
-- ============================================================
CREATE OR REPLACE FUNCTION grant_referral_credits_tx(
  p_account_id UUID,
  p_amount INT,
  p_type TEXT,
  p_related_account_id UUID,
  p_description TEXT,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE(balance_after INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w credit_wallets%ROWTYPE;
  v_new_total INT;
BEGIN
  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  UPDATE credit_wallets SET referral_credits = referral_credits + p_amount WHERE account_id = p_account_id;
  v_new_total := w.monthly_credits + w.bonus_credits + (w.referral_credits + p_amount) + w.purchased_credits + w.promo_credits;
  UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;

  INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, related_account_id, description, expires_at)
  VALUES (p_account_id, p_type, 'referral', p_amount, v_new_total, p_related_account_id, p_description, p_expires_at);

  RETURN QUERY SELECT v_new_total;
END;
$$;

GRANT EXECUTE ON FUNCTION grant_referral_credits_tx(UUID, INT, TEXT, UUID, TEXT, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- 4. grant_pending_referral_tx — referrer's signup reward, held
--    pending until the referee's 7-day activation window
-- ============================================================
CREATE OR REPLACE FUNCTION grant_pending_referral_tx(
  p_account_id UUID,
  p_amount INT,
  p_related_account_id UUID,
  p_description TEXT
) RETURNS TABLE(pending_balance INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_pending INT;
BEGIN
  UPDATE credit_wallets
  SET pending_referral_credits = pending_referral_credits + p_amount
  WHERE account_id = p_account_id
  RETURNING pending_referral_credits INTO v_new_pending;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  -- balance_after snapshots pending_referral_credits, not total_credits,
  -- for this bucket — pending credits are excluded from total_credits.
  INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, related_account_id, description)
  VALUES (p_account_id, 'referral_signup', 'pending_referral', p_amount, v_new_pending, p_related_account_id, p_description);

  RETURN QUERY SELECT v_new_pending;
END;
$$;

GRANT EXECUTE ON FUNCTION grant_pending_referral_tx(UUID, INT, UUID, TEXT) TO service_role;

-- ============================================================
-- 5. promote_pending_referral_tx — 7-day activation confirmed:
--    move pending_referral_credits into spendable referral_credits
-- ============================================================
CREATE OR REPLACE FUNCTION promote_pending_referral_tx(
  p_account_id UUID,
  p_amount INT,
  p_related_account_id UUID
) RETURNS TABLE(balance_after INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w credit_wallets%ROWTYPE;
  v_new_total INT;
  v_new_pending INT;
BEGIN
  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  v_new_pending := GREATEST(w.pending_referral_credits - p_amount, 0);
  v_new_total := w.monthly_credits + w.bonus_credits + (w.referral_credits + p_amount) + w.purchased_credits + w.promo_credits;

  UPDATE credit_wallets SET
    pending_referral_credits = v_new_pending,
    referral_credits = referral_credits + p_amount,
    total_credits = v_new_total
  WHERE account_id = p_account_id;

  INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, related_account_id, description)
  VALUES (p_account_id, 'referral_signup', 'referral', p_amount, v_new_total, p_related_account_id, 'Referral signup reward activated after 7-day window');

  RETURN QUERY SELECT v_new_total;
END;
$$;

GRANT EXECUTE ON FUNCTION promote_pending_referral_tx(UUID, INT, UUID) TO service_role;

-- ============================================================
-- 6. void_pending_referral_tx — referral marked invalid before
--    activation: pending reward never becomes spendable
-- ============================================================
CREATE OR REPLACE FUNCTION void_pending_referral_tx(
  p_account_id UUID,
  p_amount INT,
  p_related_account_id UUID,
  p_reason TEXT
) RETURNS TABLE(pending_balance INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_pending INT;
BEGIN
  UPDATE credit_wallets
  SET pending_referral_credits = GREATEST(pending_referral_credits - p_amount, 0)
  WHERE account_id = p_account_id
  RETURNING pending_referral_credits INTO v_new_pending;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, related_account_id, description)
  VALUES (p_account_id, 'expiry', 'pending_referral', -p_amount, v_new_pending, p_related_account_id, 'Pending referral reward voided: ' || p_reason);

  RETURN QUERY SELECT v_new_pending;
END;
$$;

GRANT EXECUTE ON FUNCTION void_pending_referral_tx(UUID, INT, UUID, TEXT) TO service_role;
