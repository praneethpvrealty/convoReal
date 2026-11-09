-- ============================================================
-- 20261109093000_showcase_event_types.sql
-- Two showcase intents the agent never saw: shortlisting a listing
-- (kept only in the visitor's browser) and tapping WhatsApp on it
-- (sent only to the Meta Pixel). Both now travel through the Pulse
-- beacon as showcase_events, which the type constraint has to admit.
--
-- A CHECK constraint cannot be widened in place, so this is the one
-- statement in the batch that drops something. The Supabase connector
-- holds a DROP for an interactive confirmation (handbook §7.2), so
-- this file is applied by hand, and the beacon inserts intent rows in
-- their own statement so a rejected row cannot discard the visit's
-- opens and views (src/app/api/public/showcase-events/route.ts).
-- ============================================================

ALTER TABLE showcase_events
  DROP CONSTRAINT IF EXISTS showcase_events_event_type_check;

ALTER TABLE showcase_events
  ADD CONSTRAINT showcase_events_event_type_check
  CHECK (event_type IN ('open', 'view_property', 'map_click', 'gallery', 'search', 'shortlist', 'whatsapp_click'));
