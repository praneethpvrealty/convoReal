-- ============================================================
-- 090_credit_system_fixes.sql — Credits & Referral system fixes
--
-- Introduces:
--   1. Unique index on credit_transactions(gateway_order_id) for atomic idempotency.
--   2. Realtime publication subscription for credit_wallets.
--   3. atomic purchase_credits_tx() security definer RPC.
--   4. atomic refund_credits_tx() security definer RPC.
-- ============================================================

-- 1. Uniqueness on top-up gateway_order_id
DROP INDEX IF EXISTS idx_credit_tx_gateway_order;
CREATE UNIQUE INDEX idx_credit_tx_gateway_order ON credit_transactions(gateway_order_id) WHERE gateway_order_id IS NOT NULL;

-- 2. Add credit_wallets to supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'credit_wallets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE credit_wallets;
  END IF;
END $$;

-- 3. Atomic purchase transaction RPC
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
  -- Insert ledger row first to enforce uniqueness on gateway_order_id atomically
  INSERT INTO credit_transactions (
    account_id, type, bucket, amount, balance_after, description,
    payment_gateway, gateway_payment_id, gateway_order_id
  ) VALUES (
    p_account_id, 'purchase', 'purchased', p_amount, 0, p_description,
    p_gateway, p_gateway_payment_id, p_gateway_order_id
  ) RETURNING id INTO v_tx_id;

  -- Now lock the wallet for update
  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  UPDATE credit_wallets SET
    purchased_credits = purchased_credits + p_amount
  WHERE account_id = p_account_id;

  v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + (w.purchased_credits + p_amount) + w.promo_credits;
  UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;

  -- Update transaction with the actual balance_after
  UPDATE credit_transactions SET balance_after = v_new_total WHERE id = v_tx_id;

  RETURN QUERY SELECT v_new_total, TRUE;
EXCEPTION
  WHEN unique_violation THEN
    -- Return current balance and false (not credited)
    SELECT total_credits INTO v_new_total FROM credit_wallets WHERE account_id = p_account_id;
    RETURN QUERY SELECT COALESCE(v_new_total, 0), FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION purchase_credits_tx(UUID, INT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 4. Atomic refund transaction RPC
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
  -- Select the wallet for update
  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  -- Find the most recent ai_burn transactions for this account and feature
  -- which were created in the last 5 minutes.
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
    
    -- Check if this transaction is already refunded
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
        -- Add back to the specific bucket
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

        UPDATE credit_wallets SET
          monthly_credits = w.monthly_credits,
          bonus_credits = w.bonus_credits,
          referral_credits = w.referral_credits,
          purchased_credits = w.purchased_credits,
          promo_credits = w.promo_credits
        WHERE account_id = p_account_id;

        v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
        UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;

        -- Insert the refund transaction
        INSERT INTO credit_transactions (
          account_id, type, bucket, amount, balance_after, ai_feature, description
        ) VALUES (
          p_account_id, 'refund', r.bucket, v_amt, v_new_total, p_feature, 'refund:' || r.id::text
        );
      END IF;
    END;
  END LOOP;

  -- Fallback if we couldn't find/refund enough transactions
  IF v_refunded < p_cost THEN
    DECLARE
      v_fallback_amt INT := p_cost - v_refunded;
    BEGIN
      w.purchased_credits := w.purchased_credits + v_fallback_amt;
      UPDATE credit_wallets SET purchased_credits = w.purchased_credits WHERE account_id = p_account_id;
      
      v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits + w.purchased_credits + w.promo_credits;
      UPDATE credit_wallets SET total_credits = v_new_total WHERE account_id = p_account_id;

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
