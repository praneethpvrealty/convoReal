-- ============================================================
-- 285_property_documents_100mb_and_floor_plans.sql
--
-- Two changes to how a brochure reaches a listing.
--
-- 1. property-documents was capped at 10 MB (migration 058). A
--    developer brochure forwarded to the WhatsApp intake bot is
--    routinely larger — the 33 MB PDF that prompted this was rejected
--    by storage, surfacing as "Failed to upload document" with the
--    draft left showing "Documents: 0 attached". 100 MB matches
--    WhatsApp's own document ceiling, so anything Meta will carry to
--    us is now something we can keep, and matches the chat-media
--    bucket which already sits there.
--
-- 2. properties.floor_plans — the per-floor plan drawing, for any
--    property type. Floor plans previously had nowhere to go: PDF
--    extraction dumped whatever it found into the flat images array,
--    so a plan was indistinguishable from a photo of the living room.
--    Each element is a floor:
--
--      {
--        "floor": "Ground Floor",
--        "image": "property-images/<account>/img-...jpg",
--        "area_sqft": 2400,
--        "notes": "3 BHK + pooja room"
--      }
--
--    floor_tenancies rows gain an optional "floor_plan" key holding
--    the same storage path, so a commercial rent-roll floor carries
--    its plan alongside its tenant. JSONB, so no DDL for that half.
--
-- Validation for both lives in src/lib/inventory/floor-plans.ts and
-- src/lib/inventory/floor-tenancies.ts.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 104857600 -- 100 MB
WHERE id = 'property-documents';

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS floor_plans JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN properties.floor_plans IS
  'Per-floor plan drawings: floor label, stored image path, area and notes. Applies to any property type, unlike floor_tenancies which is the commercial rent roll.';

COMMENT ON COLUMN properties.floor_tenancies IS
  'Floor-wise rent roll for pre-leased commercial buildings: tenant, monthly rent (excluding GST), lease window, lock-in, maintenance and optional floor_plan image per floor. Engine-only.';
