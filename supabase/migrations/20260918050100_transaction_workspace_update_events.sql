-- ============================================================
-- 20260918050100_transaction_workspace_update_events.sql — the
-- timeline learns the Phase 3 events. Widening a CHECK on a live table
-- is held until merge; the routes that write these types treat the
-- insert as best-effort until then. Restates the Phase 2 widening so
-- it is correct whether or not that migration has run.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deal_events
  DROP CONSTRAINT IF EXISTS deal_events_event_type_check;
ALTER TABLE deal_events
  ADD CONSTRAINT deal_events_event_type_check CHECK (event_type IN (
    'created',
    'converted_from_journey',
    'stage_changed',
    'financials_updated',
    'milestone_added',
    'milestone_updated',
    'task_added',
    'document_added',
    'document_status_changed',
    'document_superseded',
    'group_changed',
    'note_added',
    'stakeholder_added',
    'stakeholder_updated',
    'stakeholder_removed',
    'link_created',
    'link_revoked',
    'update_published',
    'update_acknowledged'
  ));
