-- ============================================================
-- 20261010153000_document_request_decided_at.sql — Record when a
--   document request was approved or rejected.
--
-- The dashboard's "Recently decided" list needs the moment the
-- decision was made. updated_at cannot stand in for it: the
-- trg_doc_request_updated_at trigger rewrites it whenever the row
-- changes, and src/lib/documents/track-view.ts writes the row on every
-- open of the shared link, so a months-old approval would resurface
-- each time its link was opened again.
-- ============================================================

ALTER TABLE property_document_requests
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_property_document_requests_account_decided
  ON property_document_requests (account_id, decided_at DESC)
  WHERE decided_at IS NOT NULL;
