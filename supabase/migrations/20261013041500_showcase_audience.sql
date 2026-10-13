-- ============================================================
-- 20261013041500_showcase_audience.sql
--
-- Per-listing audience for the public showcase, beside the page-level
-- gate of migration 254.
--
-- `showcase_visibility` decides how much of a listing a stranger
-- holding the URL gets. `showcase_audience` decides WHO the listing is
-- shown to at all:
--   all         — today's behaviour.
--   buyers_only — withheld from the showcase's co-broker view (mode=view,
--                 the clean listing view an Agent-classified contact is
--                 sent), from a visitor the link names as an Agent
--                 contact, and from a hand-picked share to an Agent
--                 contact. Buyers and strangers still see it as before.
--
-- The row never reaches the client for an excluded viewer: the public
-- payload rides the RSC stream of every showcase render and is readable
-- via view-source, so the filter runs where the catalogue is read, not
-- in CSS. NULL derives in code (src/lib/inventory/showcase-visibility.ts)
-- to 'all', the same shape as the other two per-listing privacy fields:
-- no backfill, and a per-row override stays possible.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS showcase_audience TEXT
    CHECK (showcase_audience IN ('all', 'buyers_only'));

COMMENT ON COLUMN properties.showcase_audience IS
  'Who the public showcase shows this listing to. NULL = derived (all). buyers_only withholds it from the co-broker view. See src/lib/inventory/showcase-visibility.ts.';
