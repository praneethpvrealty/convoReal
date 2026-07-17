-- ============================================================
-- 132_journey_capture.sql
-- Auto-capture WhatsApp property shares onto the Journey mind map
-- without hogging the canvas.
--
-- Sharing a property to a client from the app now upserts a
-- journey_items row — but agents share properties every day, so
-- auto-captured rows arrive HIDDEN: they don't render on the map,
-- they queue in a "Captured" tray on /journey where the agent
-- promotes the ones worth tracking (or removes the noise). Any
-- visible item can also be hidden later from its detail sheet.
--
--   journey_items.source  — how the row got here ('manual' add,
--                           'whatsapp_share' auto-capture,
--                           'chat_import' history scan,
--                           'inquiry_import' portal inquiries)
--   journey_items.hidden  — true = off the canvas, sits in the tray
--   journey_events        — gains 'hidden' / 'unhidden' event types
--                           so the timeline shows tray moves
-- ============================================================

ALTER TABLE journey_items
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'whatsapp_share', 'chat_import', 'inquiry_import')),
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN journey_items.source IS
  'How this pair landed on the journey: manual add, whatsapp_share auto-capture, chat_import history scan, or inquiry_import.';
COMMENT ON COLUMN journey_items.hidden IS
  'Hidden items stay off the mind-map canvas and wait in the Captured tray on /journey until shown or removed.';

-- Expand the event-type vocabulary with tray moves. The CHECK was
-- created inline in migration 131, so it carries the default
-- constraint name.
ALTER TABLE journey_events
  DROP CONSTRAINT IF EXISTS journey_events_event_type_check;
ALTER TABLE journey_events
  ADD CONSTRAINT journey_events_event_type_check
    CHECK (event_type IN ('added', 'advanced', 'moved', 'dropped', 'reactivated', 'hidden', 'unhidden'));
