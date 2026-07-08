-- ============================================================
-- 096_admin_grant_credits.sql — Atomic admin credit grant RPC
--
-- Manual/ops top-ups (testing, goodwill, support comps) get their
-- own ledger type instead of faking a purchase. Credits go to the
-- bonus bucket: it survives the monthly subscription reset and has
-- no expiry, so the balance only moves through real usage.
--
-- Service-role only — this must never be callable by end users.
-- Invoke via scripts/grant-credits.js.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_grant_credits_tx(
  p_account_id UUID,
  p_amount INT,
  p_description TEXT
) RETURNS TABLE(balance_after INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w credit_wallets%ROWTYPE;
  v_new_total INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'admin_grant_credits_tx: amount must be positive, got %', p_amount;
  END IF;

  SELECT * INTO w FROM credit_wallets WHERE account_id = p_account_id FOR UPDATE;
  IF w IS NULL THEN
    RAISE EXCEPTION 'No credit_wallets row for account % — call getOrCreateWallet first', p_account_id;
  END IF;

  v_new_total := w.total_credits + p_amount;

  UPDATE credit_wallets SET
    bonus_credits = bonus_credits + p_amount,
    total_credits = v_new_total,
    updated_at = NOW()
  WHERE account_id = p_account_id;

  INSERT INTO credit_transactions (
    account_id, type, bucket, amount, balance_after, description
  ) VALUES (
    p_account_id, 'admin_grant', 'bonus', p_amount, v_new_total,
    COALESCE(p_description, 'Admin credit grant')
  );

  RETURN QUERY SELECT v_new_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_grant_credits_tx(UUID, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_grant_credits_tx(UUID, INT, TEXT) TO service_role;
