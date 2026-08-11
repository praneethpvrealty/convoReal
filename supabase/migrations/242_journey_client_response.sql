-- ============================================================
-- 242_journey_client_response.sql
-- Client responses captured from forwarded chat screenshots.
--
-- Clients often answer a check-in on the agent's PERSONAL WhatsApp.
-- When the agent forwards that screenshot to the Engine, the owner
-- chatbot matches it to the contact×property journey item and logs
-- what the client said as a 'client_response' timeline event —
-- so the reply stops living only in the agent's personal chat.
-- The same event type records the client's own answer to the
-- "when should we check back?" quick-reply buttons.
-- ============================================================

ALTER TABLE journey_events
  DROP CONSTRAINT IF EXISTS journey_events_event_type_check;
ALTER TABLE journey_events
  ADD CONSTRAINT journey_events_event_type_check
    CHECK (event_type IN ('added', 'advanced', 'moved', 'dropped', 'reactivated', 'hidden', 'unhidden', 'planned', 'plan_cleared', 'client_response'));
