-- ============================================================
-- 261_pending_map_pins.sql — the map pin that arrives before the
-- listing it belongs to.
--
-- A shared Google Maps pin on its own classifies as neither a listing
-- nor a contact, so the WhatsApp assistant answered it with "I couldn't
-- tell what that was" and dropped it. Agents send the pin first and the
-- details second all the time, so the listing that followed seconds
-- later was saved with no coordinates — invisible to radius matching
-- and ad targeting, for a property whose exact location the lister had
-- already taken the trouble to send.
--
-- One row per sender: the pin is parked here and attached to the next
-- listing draft that sender opens. Deliberately short-lived (see
-- PENDING_PIN_TTL_MS in src/lib/maps/pending-pin.ts) — stamping a stale
-- pin onto an unrelated listing puts the property in the wrong place,
-- which is worse than leaving it unpinned.
--
-- Written only by service-role webhook code; account members can read
-- their own rows. Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_map_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,

  map_link TEXT NOT NULL,
  location TEXT,
  sublocality TEXT,
  city TEXT,
  state TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contact_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_map_pins_account
  ON pending_map_pins (account_id, updated_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON pending_map_pins;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pending_map_pins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE pending_map_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_map_pins_select ON pending_map_pins;
CREATE POLICY pending_map_pins_select ON pending_map_pins FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS pending_map_pins_modify ON pending_map_pins;
CREATE POLICY pending_map_pins_modify ON pending_map_pins FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

COMMENT ON TABLE pending_map_pins IS
  'A map pin shared on WhatsApp before the listing it belongs to, held for the next property draft that sender opens. See src/lib/maps/pending-pin.ts.';
