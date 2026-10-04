-- 20261004084600_burn_credits_tx_burn_key.sql
-- burn_credits_tx records its retry key in credit_transactions.burn_key
-- instead of the description.
--
-- A keyed burn used to write 'retry:<key>' as its description, which the
-- credits history shows the account. It now writes the same
-- '<feature> burn' description as every other burn and keeps the key in
-- burn_key, where refund_burn_tx (20261004084500) finds it. The
-- 60-second duplicate check reads either place, so a retry of a burn
-- written just before this migration is still recognised.
--
-- Replaces a live function: apply only after the PR carrying it merges
-- into main.

CREATE OR REPLACE FUNCTION public.burn_credits_tx(
  p_account_id uuid,
  p_feature text,
  p_cost integer,
  p_hard_block boolean,
  p_retry_key text DEFAULT NULL::text
)
RETURNS TABLE(success boolean, balance_after integer, deficit integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  w credit_wallets%ROWTYPE;
  remaining INT;
  take INT;
  v_new_total INT;
  v_description TEXT;
  v_existing_tx RECORD;
BEGIN
  IF p_retry_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx
    FROM credit_transactions
    WHERE account_id = p_account_id
      AND ai_feature = p_feature
      AND (burn_key = p_retry_key OR description = 'retry:' || p_retry_key)
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

  v_description := p_feature || ' burn';
  remaining := p_cost;

  -- Bucket priority: monthly -> bonus -> referral -> purchased -> promo.
  take := LEAST(remaining, w.monthly_credits);
  IF take > 0 THEN
    w.monthly_credits := w.monthly_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET monthly_credits = w.monthly_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description, burn_key)
    VALUES (p_account_id, 'ai_burn', 'monthly', -take, v_new_total, p_feature, v_description, p_retry_key);
  END IF;

  take := LEAST(remaining, w.bonus_credits);
  IF take > 0 THEN
    w.bonus_credits := w.bonus_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET bonus_credits = w.bonus_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description, burn_key)
    VALUES (p_account_id, 'ai_burn', 'bonus', -take, v_new_total, p_feature, v_description, p_retry_key);
  END IF;

  take := LEAST(remaining, w.referral_credits);
  IF take > 0 THEN
    w.referral_credits := w.referral_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET referral_credits = w.referral_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description, burn_key)
    VALUES (p_account_id, 'ai_burn', 'referral', -take, v_new_total, p_feature, v_description, p_retry_key);
  END IF;

  take := LEAST(remaining, w.purchased_credits);
  IF take > 0 THEN
    w.purchased_credits := w.purchased_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET purchased_credits = w.purchased_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description, burn_key)
    VALUES (p_account_id, 'ai_burn', 'purchased', -take, v_new_total, p_feature, v_description, p_retry_key);
  END IF;

  take := LEAST(remaining, w.promo_credits);
  IF take > 0 THEN
    w.promo_credits := w.promo_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET promo_credits = w.promo_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description, burn_key)
    VALUES (p_account_id, 'ai_burn', 'promo', -take, v_new_total, p_feature, v_description, p_retry_key);
  END IF;

  v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
  RETURN QUERY SELECT TRUE, v_new_total, remaining;
END;
$function$;
