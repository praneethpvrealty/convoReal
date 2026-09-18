-- ============================================================
-- 20260918010100_transaction_workspace_stage_events.sql — the
-- behaviour-changing half of the Transaction Workspace.
--
-- NOT purely additive, so it is held until the PR is merged:
--   * a trigger on `deals` writes a `stage_changed` timeline event on
--     every stage move, from either surface, including kanban drags
--     that go straight to PostgREST and never touch an API route;
--   * `journey_events` learns `converted_to_deal`, so the journey
--     timeline records the hand-off to the closing record.
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
