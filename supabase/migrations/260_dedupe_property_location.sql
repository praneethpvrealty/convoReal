-- ============================================================
-- 260_dedupe_property_location.sql — one-off repair of
-- properties.location values that repeat their own segments.
--
-- Cause (fixed in the same change, src/components/inventory/
-- property-form.tsx): opening a property for edit recovered `address`
-- from `location` by dropping segments equal to sublocality, city or
-- state, and saving re-appended those three. The comparison tested a
-- whole location segment against the raw `sublocality`, so a
-- sublocality spanning several segments — "Agara, HSR Layout" — never
-- matched "Agara" or "HSR Layout" individually, nothing was stripped,
-- and the save appended it a second time.
--
-- It compounded. The next edit recovered the doubled text as `address`
-- and appended again, which is how one row reached "JP Nagar, 5th
-- phase" three times over. Every edit made it worse.
--
-- This migration repairs the rows. The form fix stops them recurring,
-- and additionally de-duplicates on read so a stale row heals the next
-- time it is saved rather than growing.
--
-- REVERSIBLE. Every changed row's previous value is written to
-- property_location_repair_log first. To undo:
--
--   UPDATE properties p SET location = l.location_before
--   FROM property_location_repair_log l
--   WHERE l.property_id = p.id;
--
-- Idempotent — safe to run multiple times. A second run finds nothing
-- left to change and inserts no further log rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS property_location_repair_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  location_before TEXT NOT NULL,
  location_after TEXT NOT NULL,
  repaired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_location_repair_log_property
  ON property_location_repair_log (property_id);

ALTER TABLE property_location_repair_log ENABLE ROW LEVEL SECURITY;

-- Read-only to account members; nothing writes to it but this
-- migration, running as the service role.
DROP POLICY IF EXISTS property_location_repair_log_select ON property_location_repair_log;
CREATE POLICY property_location_repair_log_select
  ON property_location_repair_log FOR SELECT USING (
    is_account_member(account_id)
  );

COMMENT ON TABLE property_location_repair_log IS
  'Before/after record of the one-off properties.location de-duplication in migration 260. Kept so the repair can be reversed.';

-- ------------------------------------------------------------
-- Segment de-duplication, matching dedupeSegments() in
-- src/lib/v1/projections.ts: split on commas, trim, drop empties, keep
-- the FIRST occurrence of each segment case-insensitively, preserve
-- the original order.
--
-- Whole segments only. "100 ft JP Nagar" is deliberately kept next to
-- "JP Nagar" — dropping a segment because another contains it would
-- discard real components of other addresses.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dedupe_location_segments(p_location TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    (SELECT string_agg(d.seg, ', ' ORDER BY d.ord)
       FROM (SELECT DISTINCT ON (lower(btrim(t.seg))) btrim(t.seg) AS seg, t.ord
               FROM unnest(string_to_array(p_location, ',')) WITH ORDINALITY AS t(seg, ord)
              WHERE btrim(t.seg) <> ''
              ORDER BY lower(btrim(t.seg)), t.ord) d),
    '');
$$;

COMMENT ON FUNCTION public.dedupe_location_segments(TEXT) IS
  'Collapse repeated comma segments in a free-text location, keeping the first occurrence of each and the original order. Mirrors dedupeSegments() in src/lib/v1/projections.ts.';

-- ------------------------------------------------------------
-- The repair. Log first, then update, in one transaction so the log
-- cannot end up describing rows that were never changed.
--
-- The NULLIF guard means a location made entirely of separators is
-- left alone rather than being emptied — this migration repairs
-- duplication, it does not delete addresses.
-- ------------------------------------------------------------

WITH candidates AS (
  SELECT p.id, p.account_id, p.location AS before,
         dedupe_location_segments(p.location) AS after
  FROM properties p
  WHERE p.location IS NOT NULL
    AND p.location <> ''
),
changed AS (
  SELECT * FROM candidates
  WHERE after IS NOT NULL
    AND after IS DISTINCT FROM before
),
logged AS (
  INSERT INTO property_location_repair_log
    (property_id, account_id, location_before, location_after)
  SELECT id, account_id, before, after FROM changed
  RETURNING property_id
)
UPDATE properties p
   SET location = c.after
  FROM changed c
 WHERE p.id = c.id
   AND p.id IN (SELECT property_id FROM logged);
