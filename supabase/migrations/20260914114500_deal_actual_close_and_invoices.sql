-- ============================================================
-- 20260914114500_deal_actual_close_and_invoices.sql
--
-- Two things a closed deal needs that the pipeline could not hold.
--
-- `expected_close_date` is a forecast and stays one: it is set when the
-- deal is created and is rarely the day the sale actually closed. The
-- brokerage report, the agent payout and every "how long did this take"
-- question want the real date, so it gets its own column rather than
-- overwriting the forecast.
--
-- Invoices are the brokerage paperwork — the invoice raised on the
-- buyer or seller, and the receipt once it is paid. They are financial
-- documents, so unlike property-documents the bucket is PRIVATE: reads
-- go through short-lived signed URLs minted by
-- /api/deals/[id]/invoices, never a public object URL.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS actual_close_date DATE,
  ADD COLUMN IF NOT EXISTS invoices JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_deals_actual_close_date
  ON deals (account_id, actual_close_date DESC)
  WHERE actual_close_date IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deal-invoices',
  'deal-invoices',
  FALSE,
  10485760,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No storage policies: every read, write and delete on this bucket runs
-- through the service-role client in /api/deals/[id]/invoices, which
-- resolves the deal under the caller's own RLS first and only then
-- touches the object. An anon or authenticated client reaches nothing.
