-- ============================================================
-- 20260928042711_deal_co_broking.sql — co-broking on a closing record.
--
-- A brokerage often sits between a buyer's agent and a seller's agent.
-- The brokerage collects the whole commission and pays the other
-- brokers their share out of it. The deal held one brokerage figure,
-- so every dashboard counted the whole commission as the brokerage's
-- own, and what was owed to the others lived in notes.
--
-- `deals.brokerage_amount` keeps meaning what the brokerage collects.
-- `deal_co_broker_payouts` is one row per broker it pays: who, how
-- much, and when it went out. `deals.co_broker_payout_total` is the
-- sum, kept by trigger, so a list read of deals carries the net without
-- a join: net = brokerage collected - payouts.
-- `deals.deal_position` records where the brokerage stood.
--
-- Every column is INTERNAL ONLY, like the rest of the financials
-- (TXW-004): never selected by /api/v1, a public route or a
-- stakeholder link.
--
-- Purely additive: a new table, its triggers, and two new columns with
-- a constant default. The dashboard functions start subtracting
-- payouts in the next migration, held until merge.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS deal_position TEXT
    CHECK (deal_position IN ('direct', 'buyer_side', 'seller_side', 'intermediary')),
  ADD COLUMN IF NOT EXISTS co_broker_payout_total NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS deal_co_broker_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  stakeholder_id UUID REFERENCES deal_stakeholders(id) ON DELETE SET NULL,
  payee_name TEXT NOT NULL,
  side TEXT CHECK (side IN ('buyer', 'seller')),
  share_percent NUMERIC(6,3) CHECK (share_percent IS NULL OR (share_percent >= 0 AND share_percent <= 100)),
  amount NUMERIC(14,2) NOT NULL CONSTRAINT deal_co_broker_payouts_amount_check CHECK (amount > 0),
  paid_at DATE,
  paid_amount NUMERIC(14,2) CHECK (paid_amount IS NULL OR paid_amount >= 0),
  instrument_ref TEXT,
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_co_broker_payouts_deal
  ON deal_co_broker_payouts (deal_id, position, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_co_broker_payouts_account
  ON deal_co_broker_payouts (account_id);
CREATE INDEX IF NOT EXISTS idx_deal_co_broker_payouts_stakeholder
  ON deal_co_broker_payouts (stakeholder_id)
  WHERE stakeholder_id IS NOT NULL;

ALTER TABLE deal_co_broker_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_co_broker_payouts_select ON deal_co_broker_payouts;
CREATE POLICY deal_co_broker_payouts_select ON deal_co_broker_payouts FOR SELECT USING (
  is_account_member(account_id)
);

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

COMMENT ON TABLE deal_co_broker_payouts IS
  'Co-broker payouts: what the brokerage pays each other broker out of the commission it collects. Internal only: never selected by /api/v1, a public route or a stakeholder link.';
COMMENT ON COLUMN deals.co_broker_payout_total IS
  'Sum of deal_co_broker_payouts.amount, kept by trigger. Net brokerage = brokerage collected - this. Internal only.';
COMMENT ON COLUMN deals.deal_position IS
  'Where the brokerage stood: direct (both sides), buyer_side, seller_side, or intermediary (between two other brokers). Internal only.';
