ALTER TABLE showcase_events
  DROP CONSTRAINT IF EXISTS showcase_events_event_type_check;

ALTER TABLE showcase_events
  ADD CONSTRAINT showcase_events_event_type_check
  CHECK (event_type IN ('open', 'view_property', 'map_click', 'gallery', 'search'));

COMMENT ON COLUMN showcase_events.event_type IS
  'Visitor action: open, view_property, map_click, gallery, or search.';
