-- Guidance value notifications can be read through the Gemini Batch API at
-- half the price of interactive calls. A batch is platform data like the
-- sources it reads, so it carries no account_id; RLS is enabled with no
-- policies and only the service role (admin routes and the cron) reaches it.

CREATE TABLE IF NOT EXISTS guidance_value_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gemini_name TEXT NOT NULL UNIQUE,
  key_id UUID REFERENCES ai_provider_keys(id) ON DELETE SET NULL,
  key_label TEXT NOT NULL,
  model TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'applying', 'applied', 'failed')),
  chunks JSONB NOT NULL,
  request_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS guidance_value_batches_state_idx
  ON guidance_value_batches (state, created_at);

DROP TRIGGER IF EXISTS set_updated_at ON guidance_value_batches;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON guidance_value_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE guidance_value_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE guidance_value_sources
  ADD COLUMN IF NOT EXISTS batch_id UUID
    REFERENCES guidance_value_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS guidance_value_sources_batch_idx
  ON guidance_value_sources (batch_id) WHERE batch_id IS NOT NULL;
