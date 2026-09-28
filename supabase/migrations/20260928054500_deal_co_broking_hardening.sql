-- ============================================================
-- 20260928054500_deal_co_broking_hardening.sql — restates, idempotently,
-- every guard 20260928042711 gained after it was first applied.
--
-- 20260928042711 was applied to production before its review finished,
-- and each later change was applied there as it landed. This migration
-- carries those changes for any database that ran the first version of
-- 20260928042711: the payout table loses its client write policy, a
-- payout must be more than zero, the total moves by each row's change
-- and cannot be written directly (nor move a deal's updated_at), and the
-- guard refuses moves, unpaying a paid payout, and non-broker links.
--
-- On a database that applied the final 20260928042711 it changes
-- nothing. Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deal_co_broker_payouts DROP CONSTRAINT IF EXISTS deal_co_broker_payouts_amount_check;
ALTER TABLE deal_co_broker_payouts
  ADD CONSTRAINT deal_co_broker_payouts_amount_check CHECK (amount > 0);

-- No write policy: members read payouts, and only the routes under
-- /api/deals/[id]/co-broking write them, through the service role after
-- requireWriteRole (which also refuses read-only members), so every
-- write is parsed, rate-limited and put on the timeline. The guards
-- below still hold for any service-role writer.
DROP POLICY IF EXISTS deal_co_broker_payouts_modify ON deal_co_broker_payouts;

DROP TRIGGER IF EXISTS set_updated_at ON deal_co_broker_payouts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_co_broker_payouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The sum on the deal, moved by each row's change rather than re-summed,
-- so two concurrent edits on one deal cannot store a stale total: an
-- UPDATE of the deal row re-reads its latest committed total under the
-- row lock. SECURITY DEFINER because the writer is an agent whose own
-- deal UPDATE rights are not what decides the total: the payout rows
-- are.
CREATE OR REPLACE FUNCTION sync_deal_co_broker_payout_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE deals
       SET co_broker_payout_total = co_broker_payout_total - OLD.amount
     WHERE id = OLD.deal_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE deals
       SET co_broker_payout_total = co_broker_payout_total + NEW.amount
     WHERE id = NEW.deal_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_deal_co_broker_payout_total_trigger ON deal_co_broker_payouts;
CREATE TRIGGER sync_deal_co_broker_payout_total_trigger
  AFTER INSERT OR UPDATE OF amount, deal_id OR DELETE ON deal_co_broker_payouts
  FOR EACH ROW EXECUTE FUNCTION sync_deal_co_broker_payout_total();

REVOKE ALL ON FUNCTION sync_deal_co_broker_payout_total() FROM PUBLIC, anon, authenticated;

-- The total is derived, never written. An agent may update their deals
-- directly (RLS allows it), so a write that did not come from the
-- payout trigger above (trigger depth 1 or less) keeps the stored total
-- and a new deal starts at zero. A write that did come from it keeps
-- the deal's updated_at: team and lead-source analytics date a win by
-- it, so a payout edit must not move an old win into this period. The
-- trigger is named to fire after set_updated_at (BEFORE triggers run in
-- name order).
CREATE OR REPLACE FUNCTION protect_deal_co_broker_payout_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    IF TG_OP = 'INSERT' THEN
      NEW.co_broker_payout_total := 0;
    ELSE
      NEW.co_broker_payout_total := OLD.co_broker_payout_total;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_deal_co_broker_payout_total_trigger ON deals;
DROP TRIGGER IF EXISTS trg_deal_co_broker_payout_total ON deals;
CREATE TRIGGER trg_deal_co_broker_payout_total
  BEFORE INSERT OR UPDATE OF co_broker_payout_total ON deals
  FOR EACH ROW EXECUTE FUNCTION protect_deal_co_broker_payout_total();

-- The invariants, where a direct PostgREST write cannot skip them (the
-- RLS policy lets any agent of the account write rows, as with
-- tranches): a payout never moves to another deal or account; a paid
-- payout is corrected, never removed, and its
-- payment is never cleared back to unpaid; a deal holds at most 20
-- payouts, counted under a per-deal lock so concurrent inserts cannot
-- both pass; a payout belongs to its deal's account (the sum
-- is written back to the deal as the definer, so a payout aimed at
-- another account's deal must never land); a stakeholder named on a
-- payout is a broker on the same deal when it is named (a later role
-- change leaves the payout's history alone and never blocks paying it). A payout goes with its deal when the deal is deleted.
CREATE OR REPLACE FUNCTION deal_co_broker_payouts_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF (OLD.paid_at IS NOT NULL OR COALESCE(OLD.paid_amount, 0) > 0)
       AND EXISTS (SELECT 1 FROM deals d WHERE d.id = OLD.deal_id) THEN
      RAISE EXCEPTION 'A payout that has been paid cannot be removed'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.deal_id IS DISTINCT FROM OLD.deal_id
          OR NEW.account_id IS DISTINCT FROM OLD.account_id) THEN
    RAISE EXCEPTION 'A payout stays on its deal. Remove it and add it to the other deal instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE'
     AND (OLD.paid_at IS NOT NULL OR COALESCE(OLD.paid_amount, 0) > 0)
     AND NEW.paid_at IS NULL AND COALESCE(NEW.paid_amount, 0) = 0 THEN
    RAISE EXCEPTION 'A paid payout cannot be marked unpaid. Correct the amount or date instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('deal_co_broker_payouts:' || NEW.deal_id::text, 0));
    SELECT COUNT(*) INTO existing
    FROM deal_co_broker_payouts p
    WHERE p.deal_id = NEW.deal_id;
    IF existing >= 20 THEN
      RAISE EXCEPTION 'A deal holds at most 20 co-broker payouts'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = NEW.deal_id AND d.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'The payout and its deal belong to different accounts'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.stakeholder_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.stakeholder_id IS DISTINCT FROM OLD.stakeholder_id)
     AND NOT EXISTS (
    SELECT 1 FROM deal_stakeholders s
    WHERE s.id = NEW.stakeholder_id AND s.deal_id = NEW.deal_id
      AND s.role = 'broker'
  ) THEN
    RAISE EXCEPTION 'That stakeholder is not a broker on this deal'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deal_co_broker_payouts_guard_delete ON deal_co_broker_payouts;
CREATE TRIGGER deal_co_broker_payouts_guard_delete
  BEFORE DELETE ON deal_co_broker_payouts
  FOR EACH ROW EXECUTE FUNCTION deal_co_broker_payouts_guard();

DROP TRIGGER IF EXISTS deal_co_broker_payouts_guard_write ON deal_co_broker_payouts;
CREATE TRIGGER deal_co_broker_payouts_guard_write
  BEFORE INSERT OR UPDATE OF stakeholder_id, deal_id, account_id, paid_at, paid_amount ON deal_co_broker_payouts
  FOR EACH ROW EXECUTE FUNCTION deal_co_broker_payouts_guard();
