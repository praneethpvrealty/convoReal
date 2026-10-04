-- 20261004084500_credit_burn_keys.sql
-- Refunds that can be retried safely.
--
-- refund_credits_tx refunds the most recent matching burns of the last
-- five minutes and tops up purchased credits for any shortfall, so a
-- retry after a lost response refunds a second time. refund_burn_tx
-- refunds exactly the ledger rows written under one burn key, skips
-- rows already refunded, and never tops up, so it can be called again
-- until it succeeds. credit_refund_retries holds the refunds that still
-- failed after the caller's own retries, for the credit-refunds cron.
--
-- Purely additive: a nullable column, an index, a table and a function.

ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS burn_key TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_burn_key
  ON credit_transactions(account_id, burn_key)
  WHERE burn_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_refund_retries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  burn_key TEXT NOT NULL,
  reason TEXT,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, burn_key)
);

CREATE INDEX IF NOT EXISTS idx_credit_refund_retries_open
  ON credit_refund_retries(created_at)
  WHERE resolved_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON credit_refund_retries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON credit_refund_retries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE credit_refund_retries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_refund_retries_admin_read ON credit_refund_retries;
CREATE POLICY credit_refund_retries_admin_read ON credit_refund_retries
  FOR SELECT USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.refund_burn_tx(
  p_account_id UUID,
  p_feature TEXT,
  p_burn_key TEXT
)
RETURNS TABLE (refunded INT, balance_after INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w credit_wallets%ROWTYPE;
  r RECORD;
  v_refunded INT := 0;
  v_amt INT;
  v_new_total INT;
BEGIN
  IF p_burn_key IS NULL OR p_burn_key = '' THEN
    RAISE EXCEPTION 'refund_burn_tx needs a burn key';
  END IF;

  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account %', p_account_id;
  END IF;

  FOR r IN
    SELECT ct.id, ct.bucket, ct.amount
    FROM credit_transactions ct
    WHERE ct.account_id = p_account_id
      AND ct.type = 'ai_burn'
      AND ct.ai_feature = p_feature
      AND (ct.burn_key = p_burn_key OR ct.description = 'retry:' || p_burn_key)
      AND NOT EXISTS (
        SELECT 1 FROM credit_transactions rf
        WHERE rf.account_id = p_account_id
          AND rf.type = 'refund'
          AND rf.description = 'refund:' || ct.id::text
      )
    ORDER BY ct.created_at, ct.id
  LOOP
    v_amt := -r.amount;
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
      v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits
        + w.purchased_credits + w.promo_credits;

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
        p_account_id, 'refund', r.bucket, v_amt, v_new_total, p_feature,
        'refund:' || r.id::text
      );
    END IF;
  END LOOP;

  v_new_total := w.monthly_credits + w.bonus_credits + w.referral_credits
    + w.purchased_credits + w.promo_credits;
  RETURN QUERY SELECT v_refunded, v_new_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_burn_tx(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_burn_tx(UUID, TEXT, TEXT)
  TO service_role;
