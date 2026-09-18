-- ============================================================
-- 20260918010100_transaction_workspace_stage_events.sql — the
-- behaviour-changing half of the Transaction Workspace.
--
-- NOT purely additive, so it is held until the PR is merged:
--   * a trigger on `deals` writes a `stage_changed` timeline event on
--     every stage move, from either surface, including kanban drags
--     that go straight to PostgREST and never touch an API route;
--   * `journey_events` learns `converted_to_deal`, so the journey
--     timeline records the hand-off to the closing record;
--   * the document lifecycle and the Token Safe rule are enforced in
--     the database, not only in the routes. Both surfaces hold an anon
--     key and a member JWT and talk to PostgREST directly, and the
--     existing `deal_documents_modify` and `deals_update` policies let
--     an agent write any column — the invoice_immutability lesson.
--
-- The conversion route treats the journey event as best-effort, so
-- the code can ship before this file is applied.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE journey_events
  DROP CONSTRAINT IF EXISTS journey_events_event_type_check;
ALTER TABLE journey_events
  ADD CONSTRAINT journey_events_event_type_check
    CHECK (
      event_type IN ('added', 'advanced', 'moved', 'dropped', 'reactivated',
                    'hidden', 'unhidden', 'planned', 'plan_cleared',
                    'client_response', 'outbound_whatsapp',
                    'converted_to_deal')
    );

-- Runs as definer so the insert passes the deal_events INSERT policy
-- regardless of who moved the card; actor_id still records the caller.
CREATE OR REPLACE FUNCTION record_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_name TEXT;
  to_name TEXT;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT name INTO from_name FROM pipeline_stages WHERE id = OLD.stage_id;
  SELECT name INTO to_name FROM pipeline_stages WHERE id = NEW.stage_id;

  INSERT INTO deal_events (
    account_id, deal_id, event_type, source, actor_id, title, metadata
  ) VALUES (
    NEW.account_id,
    NEW.id,
    'stage_changed',
    'system',
    auth.uid(),
    CONCAT('Stage: ', COALESCE(from_name, '—'), ' → ', COALESCE(to_name, '—')),
    jsonb_build_object(
      'from_stage_id', OLD.stage_id,
      'to_stage_id', NEW.stage_id,
      'from_stage_name', from_name,
      'to_stage_name', to_name
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_deal_stage_change_trigger ON deals;
CREATE TRIGGER record_deal_stage_change_trigger
  AFTER UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION record_deal_stage_change();

-- ------------------------------------------------------------
-- deal_documents lifecycle (TXW-007): status only moves forward; a
-- superseded row is frozen; approved and executed papers are never
-- deleted — except when the whole deal cascades away.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_deal_document_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rank_from INTEGER;
  rank_to INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM deals WHERE deals.id = OLD.deal_id) THEN
      RETURN OLD;
    END IF;
    IF OLD.superseded_by IS NOT NULL
       OR OLD.status IN ('approved', 'executed') THEN
      RAISE EXCEPTION 'An approved, executed or superseded document is superseded, not deleted'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'A superseded document cannot change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    rank_from := CASE OLD.status
      WHEN 'draft' THEN 1 WHEN 'reviewed' THEN 2
      WHEN 'approved' THEN 3 WHEN 'executed' THEN 4 ELSE 0 END;
    rank_to := CASE NEW.status
      WHEN 'draft' THEN 1 WHEN 'reviewed' THEN 2
      WHEN 'approved' THEN 3 WHEN 'executed' THEN 4 ELSE 0 END;
    IF rank_to <= rank_from THEN
      RAISE EXCEPTION 'Document status only moves forward'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF NEW.superseded_by IS NOT NULL AND NEW.superseded_by = NEW.id THEN
    RAISE EXCEPTION 'A document cannot supersede itself'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_deal_document_lifecycle_trigger ON deal_documents;
CREATE TRIGGER enforce_deal_document_lifecycle_trigger
  BEFORE UPDATE OR DELETE ON deal_documents
  FOR EACH ROW EXECUTE FUNCTION enforce_deal_document_lifecycle();

-- ------------------------------------------------------------
-- Token Safe ownership (TXW-006): a deal that closes a Den room reads
-- its token from token_escrows and may not carry one of its own.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_deal_token_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.deal_room_id IS NOT NULL AND (
       NEW.token_amount IS NOT NULL
    OR NEW.token_received_at IS NOT NULL
    OR NEW.token_instrument_ref IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Token money for a Den-linked deal is recorded in Token Safe; clear token_amount, token_received_at and token_instrument_ref'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_deal_token_source_trigger ON deals;
CREATE TRIGGER enforce_deal_token_source_trigger
  BEFORE INSERT OR UPDATE OF deal_room_id, token_amount, token_received_at, token_instrument_ref ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_deal_token_source();
