-- ============================================================
-- 102_track_repeat_document_views.sql — Track every open of a shared
--   document link, not just the first.
--
-- 101 added viewed_at but only ever recorded the FIRST view — a
-- forwarded link (the original recipient opens it, then forwards to
-- someone else who opens it too) silently dropped every open after
-- the first. view_count + last_viewed_at let every subsequent open
-- register as its own event; viewed_at is kept as-is (now reads as
-- "first viewed at").
-- ============================================================

ALTER TABLE property_document_requests
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

-- Backfill: anything already viewed under 101 counts as one view so
-- far.
UPDATE property_document_requests
SET view_count = 1, last_viewed_at = viewed_at
WHERE viewed_at IS NOT NULL AND view_count = 0;
