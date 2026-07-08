-- ============================================================
-- 094_match_radar.sql
--
-- Match Radar: proactive matching events. When a property is
-- created/approved, or a buyer's AI-extracted preferences change,
-- the radar engine (src/lib/radar/engine.ts) computes matches with
-- the existing matching engine and records an event here. The
-- /radar page surfaces events with a one-tap WhatsApp send.
-- ============================================================

CREATE TABLE IF NOT EXISTS match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 'new_property': property_id is the subject, matches[] are contacts.
  -- 'buyer_updated': contact_id is the subject, matches[] are properties.
  kind TEXT NOT NULL CHECK (kind IN ('new_property', 'buyer_updated')),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  -- Array of { id, score, tier fields } snapshots computed at event time.
  -- Kept as a snapshot (not recomputed on read) so the feed is stable and
  -- cheap; the send route re-verifies targets still exist before sending.
  matches JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'sent', 'dismissed')),
  sent_count INT NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_events_account_status
  ON match_events (account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_events_property
  ON match_events (account_id, property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_match_events_contact
  ON match_events (account_id, contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;

-- Any account member can read the feed
DROP POLICY IF EXISTS match_events_select ON match_events;
CREATE POLICY match_events_select ON match_events FOR SELECT USING (
  is_account_member(account_id)
);

-- Agents+ can update (dismiss) events; inserts come from the service-role
-- radar engine, deletes only via cascade.
DROP POLICY IF EXISTS match_events_update ON match_events;
CREATE POLICY match_events_update ON match_events FOR UPDATE USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_match_events_updated_at ON match_events;
CREATE TRIGGER set_match_events_updated_at BEFORE UPDATE ON match_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
