-- ============================================================
-- 092_add_doc_request_password.sql
--
-- Adds access_password column to property_document_requests table.
-- ============================================================

ALTER TABLE property_document_requests
  ADD COLUMN IF NOT EXISTS access_password TEXT;
