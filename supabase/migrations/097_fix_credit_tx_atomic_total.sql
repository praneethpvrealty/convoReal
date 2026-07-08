-- ============================================================
-- 097_fix_credit_tx_atomic_total.sql — Fix credit_wallets check
--   constraint violations in the credit-mutation RPCs.
--
-- BUG: burn_credits_tx (089), purchase_credits_tx and
-- refund_credits_tx (090) each mutate a bucket column in ONE
-- statement and then set total_credits in a SEPARATE statement:
--
--     UPDATE credit_wallets SET bonus_credits = <new> WHERE ...;   -- (1)
--     UPDATE credit_wallets SET total_credits = <new> WHERE ...;   -- (2)
--
-- credit_wallets carries a NON-deferrable CHECK constraint
-- (migration 085):
--     total_credits = monthly + bonus + referral + purchased + promo
--
-- CHECK constraints are evaluated at the end of EVERY statement, so
-- after statement (1) the row is transiently inconsistent
-- (bucket changed, total not) and the constraint fires:
--     "new row for relation credit_wallets violates check constraint
--      credit_wallets_check"
--
-- The whole function aborts. Soft burns swallow the exception and
-- proceed (so AI ran without ever deducting — silent revenue leak);
-- hard burns 500'd; purchases/refunds failed outright. The unit tests
-- mock the RPC, so this SQL-level bug was invisible to CI.
--
-- FIX: set the bucket AND total_credits in a SINGLE UPDATE so the row
-- is consistent at every statement boundary. No behavioural change
-- beyond "it now succeeds". Idempotency, bucket priority, ledger rows,
-- hard-block semantics and grants are all preserved verbatim.
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
  take := LEAST(remaining, w.monthly_credits);
  IF take > 0 THEN
    w.monthly_credits := w.monthly_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET monthly_credits = w.monthly_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'monthly', -take, v_new_total, p_feature, v_description);
  END IF;

  take := LEAST(remaining, w.bonus_credits);
  IF take > 0 THEN
    w.bonus_credits := w.bonus_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET bonus_credits = w.bonus_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'bonus', -take, v_new_total, p_feature, v_description);
  END IF;

  take := LEAST(remaining, w.referral_credits);
  IF take > 0 THEN
    w.referral_credits := w.referral_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET referral_credits = w.referral_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'referral', -take, v_new_total, p_feature, v_description);
  END IF;

  take := LEAST(remaining, w.purchased_credits);
  IF take > 0 THEN
    w.purchased_credits := w.purchased_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET purchased_credits = w.purchased_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'purchased', -take, v_new_total, p_feature, v_description);
  END IF;

  take := LEAST(remaining, w.promo_credits);
  IF take > 0 THEN
    w.promo_credits := w.promo_credits - take;
    remaining := remaining - take;
    v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
    UPDATE credit_wallets SET promo_credits = w.promo_credits, total_credits = v_new_total WHERE account_id = p_account_id;
    INSERT INTO credit_transactions (account_id, type, bucket, amount, balance_after, ai_feature, description)
    VALUES (p_account_id, 'ai_burn', 'promo', -take, v_new_total, p_feature, v_description);
  END IF;

  v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
  RETURN QUERY SELECT TRUE, v_new_total, remaining;
END;
$$;

GRANT EXECUTE ON FUNCTION burn_credits_tx(UUID, TEXT, INT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION burn_credits_tx(UUID, TEXT, INT, BOOLEAN, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION purchase_credits_tx(
  p_account_id UUID,
  p_amount INT,
  p_description TEXT,
  p_gateway TEXT,
  p_gateway_payment_id TEXT,
  p_gateway_order_id TEXT
) RETURNS TABLE(balance_after INT, success BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tx_id UUID;
  w credit_wallets%ROWTYPE;
  v_new_total INT;
BEGIN
  INSERT INTO credit_transactions (
    account_id, type, bucket, amount, balance_after, description,
    payment_gateway, gateway_payment_id, gateway_order_id
  ) VALUES (
    p_account_id, 'purchase', 'purchased', p_amount, 0, p_description,
    p_gateway, p_gateway_payment_id, p_gateway_order_id
  ) RETURNING id INTO v_tx_id;

  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + (w.purchased_credits + p_amount) + w.promo_credits;
  UPDATE credit_wallets SET
    purchased_credits = purchased_credits + p_amount,
    total_credits = v_new_total
  WHERE account_id = p_account_id;

  UPDATE credit_transactions SET balance_after = v_new_total WHERE id = v_tx_id;

  RETURN QUERY SELECT v_new_total, TRUE;
EXCEPTION
  WHEN unique_violation THEN
    SELECT total_credits INTO v_new_total FROM credit_wallets WHERE account_id = p_account_id;
    RETURN QUERY SELECT COALESCE(v_new_total, 0), FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION purchase_credits_tx(UUID, INT, TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION refund_credits_tx(
  p_account_id UUID,
  p_feature TEXT,
  p_cost INT,
  p_description TEXT
) RETURNS TABLE(balance_after INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_total INT;
  r RECORD;
  v_refunded INT := 0;
  w credit_wallets%ROWTYPE;
BEGIN
  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  FOR r IN
    SELECT id, bucket, amount
    FROM credit_transactions
    WHERE account_id = p_account_id
      AND type = 'ai_burn'
      AND ai_feature = p_feature
      AND created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY created_at DESC, id DESC
  LOOP
    EXIT WHEN v_refunded >= p_cost;

    IF EXISTS (
      SELECT 1 FROM credit_transactions
      WHERE account_id = p_account_id
        AND type = 'refund'
        AND description = 'refund:' || r.id::text
    ) THEN
      CONTINUE;
    END IF;

    DECLARE
      v_amt INT := LEAST(p_cost - v_refunded, -r.amount);
    BEGIN
      IF v_amt > 0 THEN
        IF r.bucket = 'monthly' THEN
          w.monthly_credits := w.monthly_credits + v_amt;
        ELSIF r.bucket = 'bonus' THEN
          w.bonus_credits := w.bonus_credits + v_amt;
        ELSIF r.bucket = 'referral' THEN
          w.referral_credits := w.referral_credits + v_amt;
        ELSIF r.bucket = 'purchased' THEN
          w.purchased_credits := w.purchased_credits + v_amt;
        ELSIF r.bucket = 'promo' THEN
          w.promo_credits := w.promo_credits + v_amt;
        END IF;

        v_refunded := v_refunded + v_amt;
        v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;

        UPDATE credit_wallets SET
          monthly_credits = w.monthly_credits,
          bonus_credits = w.bonus_credits,
          referral_credits = w.referral_credits,
          purchased_credits = w.purchased_credits,
          promo_credits = w.promo_credits,
          total_credits = v_new_total
        WHERE account_id = p_account_id;

        INSERT INTO credit_transactions (
          account_id, type, bucket, amount, balance_after, ai_feature, description
        ) VALUES (
          p_account_id, 'refund', r.bucket, v_amt, v_new_total, p_feature, 'refund:' || r.id::text
        );
      END IF;
    END;
  END LOOP;

  IF v_refunded < p_cost THEN
    DECLARE
      v_fallback_amt INT := p_cost - v_refunded;
    BEGIN
      w.purchased_credits := w.purchased_credits + v_fallback_amt;
      v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;

      UPDATE credit_wallets SET
        purchased_credits = w.purchased_credits,
        total_credits = v_new_total
      WHERE account_id = p_account_id;

      INSERT INTO credit_transactions (
        account_id, type, bucket, amount, balance_after, ai_feature, description
      ) VALUES (
        p_account_id, 'refund', 'purchased', v_fallback_amt, v_new_total, p_feature, p_description
      );
    END;
  END IF;

  v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
  RETURN QUERY SELECT v_new_total;
END;
$$;

GRANT EXECUTE ON FUNCTION refund_credits_tx(UUID, TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_credits_tx(UUID, TEXT, INT, TEXT) TO service_role;
