-- ============================================================
-- 095_showcase_pulse.sql
--
-- Showcase Pulse: engagement events from public showcase links.
-- The showcase already personalizes links per contact (?ref=…);
-- the client beacons open/view events to
-- POST /api/public/showcase-events, which inserts here via the
-- service role. The /pulse page aggregates per account.
--
-- Privacy posture: no IP or user-agent stored; session_key is a
-- random client-generated id (localStorage) used only to count
-- unique devices and stitch a visit timeline.
-- ============================================================

CREATE TABLE IF NOT EXISTS showcase_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Resolved from the ?ref= param when it points at a contact; null for
  -- anonymous/portal traffic.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('open', 'view_property', 'map_click', 'gallery')),
  -- e.g. { "duration_ms": 12000 } for view_property
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_showcase_events_account_time
  ON showcase_events (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showcase_events_contact
  ON showcase_events (account_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_showcase_events_property
  ON showcase_events (account_id, property_id) WHERE property_id IS NOT NULL;

ALTER TABLE showcase_events ENABLE ROW LEVEL SECURITY;

-- Account members read their own events; inserts come only from the
-- service-role beacon route (no anon INSERT policy on purpose — the
-- public route validates + rate-limits before writing).
DROP POLICY IF EXISTS showcase_events_select ON showcase_events;
CREATE POLICY showcase_events_select ON showcase_events FOR SELECT USING (
  is_account_member(account_id)
);
