-- ============================================================
-- Multi-contact appointments + revised client reminder cadence.
--
-- NOTE: apply this migration BEFORE deploying the matching app
-- code — the new columns are written on every appointment insert.
--
-- appointments.contact_ids lets one event carry every party to a
-- deal (buyer, partner agent, owner…). contact_id stays as the
-- primary contact for backward compatibility — a trigger keeps it
-- mirroring the first element of contact_ids, whichever column a
-- writer sets.
--
-- Client reminders move from the 24h/2h scheme to:
--   1. Morning-of brief once ~7 AM IST opens (reminder_morning_sent)
--   2. One hour before the meeting           (reminder_1h_sent)
-- Both go to EVERY contact in contact_ids, with per-recipient
-- delivery tracked in appointment_reminder_log so partial send
-- failures retry only the missed recipients. The old
-- reminder_24h_sent / reminder_2h_sent flags are left in place but
-- are no longer written by the cron.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS contact_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reminder_morning_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_1h_sent BOOLEAN NOT NULL DEFAULT false;

-- Existing single-contact appointments: seed the array from the
-- legacy column so reminders keep reaching the original contact.
UPDATE appointments
  SET contact_ids = ARRAY[contact_id]
  WHERE contact_id IS NOT NULL AND contact_ids = '{}';

-- Events already in the past never need the new reminders; mark
-- them sent so the cron's flag scans skip the whole backlog.
UPDATE appointments
  SET reminder_morning_sent = true, reminder_1h_sent = true
  WHERE start_time <= NOW();

-- Transition guard: upcoming events already reminded under the old
-- 24h/2h scheme shouldn't be re-reminded by the new cadence right
-- after deploy.
UPDATE appointments
  SET reminder_morning_sent = true
  WHERE (reminder_24h_sent = true OR reminder_2h_sent = true) AND reminder_morning_sent = false;
UPDATE appointments
  SET reminder_1h_sent = true
  WHERE reminder_2h_sent = true AND reminder_1h_sent = false;

CREATE INDEX IF NOT EXISTS idx_appointments_contact_ids
  ON appointments USING GIN (contact_ids);

-- ── contact_id ↔ contact_ids invariant, enforced at the database ──
-- Writers set either column (legacy paths set only contact_id; new
-- paths set contact_ids). The trigger dedupes the array, seeds it
-- from a lone contact_id, and always mirrors contact_id to the
-- first element — so no insert path can let the two drift apart.
CREATE OR REPLACE FUNCTION sync_appointment_contacts()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contact_ids IS NULL THEN
    NEW.contact_ids := '{}';
  END IF;

  -- A legacy writer changed contact_id alone: refresh the array.
  IF TG_OP = 'UPDATE'
     AND NEW.contact_id IS DISTINCT FROM OLD.contact_id
     AND NEW.contact_ids = OLD.contact_ids THEN
    NEW.contact_ids := CASE
      WHEN NEW.contact_id IS NULL THEN '{}'::uuid[]
      ELSE ARRAY[NEW.contact_id]
    END;
  ELSIF NEW.contact_ids = '{}' AND NEW.contact_id IS NOT NULL THEN
    NEW.contact_ids := ARRAY[NEW.contact_id];
  END IF;

  -- De-duplicate, preserving first-occurrence order.
  NEW.contact_ids := (
    SELECT COALESCE(array_agg(id ORDER BY first_ord), '{}'::uuid[])
    FROM (
      SELECT id, MIN(ord) AS first_ord
      FROM unnest(NEW.contact_ids) WITH ORDINALITY AS t(id, ord)
      WHERE id IS NOT NULL
      GROUP BY id
    ) dedup
  );

  -- The primary contact is always the first of the array.
  NEW.contact_id := NEW.contact_ids[1];
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_appointment_contacts ON appointments;
CREATE TRIGGER trg_sync_appointment_contacts
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION sync_appointment_contacts();

-- ── Per-recipient reminder delivery log ───────────────────────────
-- One row per (appointment, contact, reminder type) — the claim the
-- cron inserts before each send (released on failure), mirroring the
-- agent_digest_log pattern. Guarantees no duplicate reminders across
-- cron races while letting missed recipients retry individually.
CREATE TABLE IF NOT EXISTS appointment_reminder_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('morning', '1h')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (appointment_id, contact_id, reminder_type)
);

ALTER TABLE appointment_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view own account reminder log" ON appointment_reminder_log;
CREATE POLICY "Members can view own account reminder log" ON appointment_reminder_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_id = appointment_reminder_log.account_id
    )
  );

COMMENT ON COLUMN appointments.contact_ids IS
  'All contacts attached to this event (buyer, partner agent, owner…). contact_id mirrors the first element as the primary contact (enforced by trg_sync_appointment_contacts).';
COMMENT ON COLUMN appointments.reminder_morning_sent IS
  'Morning-of (~7 AM IST) WhatsApp reminder delivered to every linked contact.';
COMMENT ON COLUMN appointments.reminder_1h_sent IS
  'One-hour-before WhatsApp reminder delivered to every linked contact.';
