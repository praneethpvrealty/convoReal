-- ============================================================
-- 20260924150100_deal_payment_tranches_guards.sql — the schedule's two
-- invariants, enforced where a direct PostgREST write cannot skip them.
--
-- The RLS policy on deal_payment_tranches lets any agent of the
-- account write rows, as the milestone and stakeholder tables do. The
-- route is the only writer in application code, but an agent holding
-- the anon key and their JWT can reach the table directly and skip the
-- route's checks. Two of those checks are invariants (TXW-021), so
-- they live here too:
--
--   * a tranche with money against it is corrected, never removed;
--   * a schedule holds at most 40 tranches.
--
-- Purely additive: one function, two triggers. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION deal_payment_tranches_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.received_at IS NOT NULL OR COALESCE(OLD.received_amount, 0) > 0 THEN
      RAISE EXCEPTION 'A tranche with money received cannot be removed'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT COUNT(*) INTO existing
    FROM deal_payment_tranches t
    WHERE t.deal_id = NEW.deal_id;
    IF existing >= 40 THEN
      RAISE EXCEPTION 'A schedule holds at most 40 tranches'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deal_payment_tranches_guard_delete ON deal_payment_tranches;
CREATE TRIGGER deal_payment_tranches_guard_delete
  BEFORE DELETE ON deal_payment_tranches
  FOR EACH ROW EXECUTE FUNCTION deal_payment_tranches_guard();

DROP TRIGGER IF EXISTS deal_payment_tranches_guard_insert ON deal_payment_tranches;
CREATE TRIGGER deal_payment_tranches_guard_insert
  BEFORE INSERT ON deal_payment_tranches
  FOR EACH ROW EXECUTE FUNCTION deal_payment_tranches_guard();
