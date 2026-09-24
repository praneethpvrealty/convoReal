-- ============================================================
-- 20260924140000_deal_payment_tranches.sql — the payment schedule on a
-- closing record.
--
-- An 11.5 crore purchase with a 5 crore cash leg, or a 16 crore land
-- deal, is paid in several tranches: token, agreement, registration,
-- possession. The financials held one token entry and one free-text
-- instrument field, so the schedule lived outside the app. This table
-- is one row per tranche: what is due, when, what has come in and by
-- which instrument. It is record-keeping, like the rest of the
-- financials (docs/transaction-workspace.md): no ledgering, no
-- reconciliation.
--
-- Every column is INTERNAL ONLY, as the deal's financial columns are
-- (TXW-004): the table is never selected by /api/v1, a public route or
-- a stakeholder link. Amounts never ride a timeline event.
--
-- Purely additive. Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_payment_tranches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  due_date DATE,
  received_at DATE,
  received_amount NUMERIC(14,2) CHECK (received_amount IS NULL OR received_amount >= 0),
  instrument_ref TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_payment_tranches_deal
  ON deal_payment_tranches (deal_id, position, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_payment_tranches_account
  ON deal_payment_tranches (account_id);
CREATE INDEX IF NOT EXISTS idx_deal_payment_tranches_due
  ON deal_payment_tranches (account_id, due_date)
  WHERE due_date IS NOT NULL AND received_at IS NULL;

ALTER TABLE deal_payment_tranches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_payment_tranches_select ON deal_payment_tranches;
CREATE POLICY deal_payment_tranches_select ON deal_payment_tranches FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS deal_payment_tranches_modify ON deal_payment_tranches;
CREATE POLICY deal_payment_tranches_modify ON deal_payment_tranches FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_updated_at ON deal_payment_tranches;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_payment_tranches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE deal_payment_tranches IS
  'Payment schedule of a closing record, one row per tranche. Internal only: never selected by /api/v1, a public route or a stakeholder link.';
