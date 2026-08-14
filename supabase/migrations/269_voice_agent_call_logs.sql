-- 269_voice_agent_call_logs.sql
-- Voice-agent ingestion on the contact call journal: rows written by
-- POST /api/webhooks/voice-agent (Sarvam Voice Agents post-call
-- webhook — see docs/voice-agent-integration-plan.md) alongside the
-- entries agents log by hand. `source` tells the two apart;
-- `external_call_id` carries the provider's own call id so a retried
-- webhook delivery cannot journal the same call twice.

ALTER TABLE contact_call_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'voice_agent')),
  ADD COLUMN IF NOT EXISTS external_call_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_logs_external_call
  ON contact_call_logs(account_id, external_call_id)
  WHERE external_call_id IS NOT NULL;
