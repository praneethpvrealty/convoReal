-- Ledger id from the Cloudflare email worker, used by the lead-sync
-- reconcile cron to tell "already ingested" from "never arrived" without
-- reprocessing (which would re-send auto-replies to the lead).
ALTER TABLE email_sync_logs ADD COLUMN IF NOT EXISTS ledger_id TEXT;

CREATE INDEX IF NOT EXISTS idx_email_sync_logs_ledger_id
  ON email_sync_logs (ledger_id)
  WHERE ledger_id IS NOT NULL;
