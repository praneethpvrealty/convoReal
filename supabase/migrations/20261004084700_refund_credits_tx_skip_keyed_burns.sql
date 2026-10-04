-- 20261004084700_refund_credits_tx_skip_keyed_burns.sql
-- refund_credits_tx leaves burns refunded by key to refund_burn_tx.
--
-- refund_credits_tx refunds the most recent burns of a feature. A burn
-- made under a key from newBurnKey ('<feature>:<uuid>') is refunded by
-- refund_burn_tx against that key, so if refund_credits_tx took such a
-- burn first, the keyed refund would find it already refunded and the
-- caller's own unkeyed burn would stay charged. Those burns are now
-- skipped here, whether the key is in burn_key or, for burns made before
-- 20261004084600, in a 'retry:<key>' description. Keys other callers pass
-- (voice-call:, unlock:, reminder-audio:, sweep:, voice-reminder:) never
-- start with a feature name, so their refunds are unchanged.
--
-- Replaces a live function: apply only after the PR carrying it merges
-- into main.

CREATE OR REPLACE FUNCTION public.refund_credits_tx(
  p_account_id uuid,
  p_feature text,
  p_cost integer,
  p_description text
)
RETURNS TABLE(balance_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      AND left(COALESCE(burn_key, ''), length(p_feature) + 1) <> p_feature || ':'
      AND left(COALESCE(description, ''), length(p_feature) + 7) <> 'retry:' || p_feature || ':'
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
$function$;
