-- A queue request for the Gemini Batch API is remembered on each waiting
-- notification, so the guidance-batches cron keeps queuing what one
-- time-limited request could not reach, even after the admin leaves the
-- page.

ALTER TABLE guidance_value_sources
  ADD COLUMN IF NOT EXISTS batch_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS guidance_value_sources_batch_requested_idx
  ON guidance_value_sources (batch_requested_at)
  WHERE batch_requested_at IS NOT NULL;
