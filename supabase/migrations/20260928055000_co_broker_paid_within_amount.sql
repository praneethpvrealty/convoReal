-- ============================================================
-- 20260928055000_co_broker_paid_within_amount.sql — a co-broker
-- payout's recorded part payment is more than zero and never more than
-- the payout. (A blank part amount means the full payout; a zero would
-- read as unpaid while the payout keeps its paid date.)
--
-- The summary capped an overpayment at the payout amount, so the paid
-- out figure hid it. The route now refuses it, and so does the table,
-- for a new row and for an amount lowered below what was paid.
--
-- Purely additive: one check on a table with no rows yet. Idempotent:
-- it drops and re-adds the check, so re-running it converges.
-- ============================================================

ALTER TABLE deal_co_broker_payouts
  DROP CONSTRAINT IF EXISTS deal_co_broker_payouts_paid_within_amount;
ALTER TABLE deal_co_broker_payouts
  ADD CONSTRAINT deal_co_broker_payouts_paid_within_amount
  CHECK (paid_amount IS NULL OR (paid_amount > 0 AND paid_amount <= amount));
