-- ============================================================
-- 20260918030100_transaction_workspace_share_events.sql — the timeline
-- learns the Phase 2 events. Widening a CHECK on a live table is held
-- until merge; the routes that write these types treat the insert as
-- best-effort until then.
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
    'link_revoked'
  ));
