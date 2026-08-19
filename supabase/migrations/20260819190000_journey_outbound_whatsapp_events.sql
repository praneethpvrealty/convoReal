-- =========================================================
-- 20260819190000_journey_outbound_whatsapp_events.sql
-- Capturing outbound personal WhatsApp sends to journey items.
-- ---------------------------------------------------------
-- Personal-WA sends are currently emitted from two surfaces:
-- web Composer + Journey sheet, and mobile Composer fallback path.
-- This migration adds metadata + a dedupe key so the same send
-- cannot create duplicate timeline rows when users hit the button twice.
-- =========================================================

ALTER TABLE journey_events
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

ALTER TABLE journey_events
  DROP CONSTRAINT IF EXISTS journey_events_event_type_check;
ALTER TABLE journey_events
  ADD CONSTRAINT journey_events_event_type_check
    CHECK (
      event_type IN ('added', 'advanced', 'moved', 'dropped', 'reactivated',
                    'hidden', 'unhidden', 'planned', 'plan_cleared',
                    'client_response', 'outbound_whatsapp')
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_journey_events_item_event_dedupe
  ON journey_events (account_id, item_id, event_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
