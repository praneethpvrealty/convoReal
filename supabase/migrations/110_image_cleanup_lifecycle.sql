-- ============================================================
-- Property image cleanup: safe staged lifecycle.
--
-- Replaces the old "delete images the moment a property is Sold"
-- behaviour with a reversible state machine driven by a cron:
--   active → warned → dereferenced → purged
-- (warn the owner → after a grace period clear the images from the
-- listing but KEEP the blobs + a snapshot → optional final hard
-- delete, opt-in). Eligibility is measured with a DURABLE
-- status_changed_at timestamp instead of updated_at (which is bumped
-- by every write via set_properties_updated_at).
--
-- See src/lib/storage/image-cleanup.ts for the engine and
-- image_cleanup_config in system_settings for the tunables.
-- ============================================================

-- ── Lifecycle columns on properties ──────────────────────────────────────────
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS status_changed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS images_cleanup_state     TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS images_cleanup_warned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS images_dereferenced_at   TIMESTAMPTZ;

-- Durable "how long has this property been in its current status" clock.
-- Only moves when status actually changes (or on insert) — immune to the
-- unrelated edits that bump updated_at.
CREATE OR REPLACE FUNCTION set_status_changed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.status_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_properties_status_changed_at ON properties;
CREATE TRIGGER set_properties_status_changed_at
  BEFORE INSERT OR UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_status_changed_at();

-- Backfill existing rows with their last known write time (best-effort
-- historical dwell). Only touches rows not yet populated, so re-running
-- the migration is a no-op.
UPDATE properties
  SET status_changed_at = updated_at
  WHERE status_changed_at IS NULL;

-- Eligibility index: the cron scans by (state, status, dwell) over rows
-- that still have images.
CREATE INDEX IF NOT EXISTS idx_properties_image_cleanup
  ON properties (images_cleanup_state, status, status_changed_at)
  WHERE array_length(images, 1) > 0;

-- ── image_cleanup_log (audit + restore snapshot) ─────────────────────────────
-- Modeled on contact_merge_log (074): account-scoped, RLS SELECT for
-- members, NO insert policy (service-role only). The `snapshot` JSONB on a
-- 'dereference' row is the ONLY record of the original image URLs after the
-- listing's images array is cleared — it powers the restore endpoint.
CREATE TABLE IF NOT EXISTS image_cleanup_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id  UUID,                       -- raw; property may be deleted later
  phase        TEXT NOT NULL,              -- warn | dereference | purge | reset | restore
  image_count  INT  NOT NULL DEFAULT 0,
  snapshot     JSONB,                      -- { images: string[], status: text }
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE image_cleanup_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS image_cleanup_log_select ON image_cleanup_log;
CREATE POLICY image_cleanup_log_select
  ON image_cleanup_log FOR SELECT
  USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policies: only the service-role cron writes here.

CREATE INDEX IF NOT EXISTS idx_image_cleanup_log_account
  ON image_cleanup_log (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_cleanup_log_property
  ON image_cleanup_log (property_id, created_at DESC);
