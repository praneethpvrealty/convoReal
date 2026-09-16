-- ============================================================
-- 20260916041500_consolidate_deal_invoice_uploads.sql
--
-- Two places held an invoice file against a deal: `deals.invoices`
-- (a JSONB array over the `deal-invoices` bucket) and `deal_documents`
-- with category 'invoice' (a real table over `deal-documents`). An agent
-- had no way to tell which one the invoice they were looking for was in,
-- and the JSONB side carried no category, no contact attribution, no
-- extraction and no per-row audit.
--
-- The folder wins. This migration is in two halves because they carry
-- different risk:
--
--   1. PERMISSIVE, applied as soon as the branch is pushed. The folder
--      accepted only PDFs and photos, while the retired bucket also took
--      Word and Excel — and a brokerage's invoice is very often an .xlsx
--      workbook. Widening the folder first means no upload that worked
--      yesterday fails today.
--
--   2. DESTRUCTIVE, held until the PR is green and merged. Dropping
--      `deals.invoices` is irreversible, so it does not run against
--      production while the branch could still be abandoned.
--
-- The `deal-invoices` bucket itself is removed out of band: Supabase's
-- storage.protect_delete() refuses a bucket DELETE over SQL.
-- ============================================================

-- ---- 1. Permissive half -------------------------------------
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12'
]
WHERE id = 'deal-documents';

-- A deal's papers are found by walking its folder, and the invoice tab
-- reads one category out of it. Without this, both scan the deal.
CREATE INDEX IF NOT EXISTS idx_deal_documents_deal_category
  ON deal_documents (deal_id, category, created_at DESC);

-- ---- 2. Destructive half ------------------------------------
-- Run only after this PR has merged.
ALTER TABLE deals DROP COLUMN IF EXISTS invoices;
