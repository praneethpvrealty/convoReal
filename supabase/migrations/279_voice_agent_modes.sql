-- ============================================================
-- 278_voice_agent_modes.sql — how an account gets its calls made.
--
-- Three ways, chosen by the account owner:
--
--   shared    — the platform's agent and number. Nothing to set up,
--               so a brokerage can try qualification calls or run one
--               a quarter without provisioning telephony. Calls show
--               a ConvoReal number, and callbacks to it cannot be
--               attributed to a tenant, so it is outbound-only.
--   dedicated — the account's own agent and number inside the
--               platform's provider workspace. Their caller id, their
--               callbacks, our bill and our channel pool.
--   byo       — the account's own provider credentials entirely.
--               Their bill, their compliance, their channel pool.
--
-- The key is encrypted at rest exactly like whatsapp_config.access_token
-- (AES-256-GCM via ENCRYPTION_KEY) and is never returned to a client.
-- ============================================================

ALTER TABLE voice_agent_config
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'shared',
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_agent_config_mode_check'
  ) THEN
    ALTER TABLE voice_agent_config
      ADD CONSTRAINT voice_agent_config_mode_check
      CHECK (mode IN ('shared', 'dedicated', 'byo'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_agent_config_provider_check'
  ) THEN
    ALTER TABLE voice_agent_config
      ADD CONSTRAINT voice_agent_config_provider_check
      CHECK (provider IS NULL OR provider IN ('sarvam', 'custom'));
  END IF;
END $$;

-- Accounts configured before modes existed named their own agent and
-- dialled it with the platform key — that is 'dedicated', not the
-- 'shared' default a brand-new account gets.
UPDATE voice_agent_config
SET mode = 'dedicated'
WHERE agent_ref IS NOT NULL AND mode = 'shared';
