-- ============================================================
-- 106_meta_ads_config.sql — Meta Ads (Click-to-WhatsApp) connection
--   per account (Meta Ads integration, Phase B).
--
-- One row per account, mirroring whatsapp_config's shape: an
-- encrypted long-lived user access token plus the ad account / Page /
-- Instagram account the agent selected to run ads from. Written and
-- read only by the /api/meta-ads/* routes via the service-role client
-- (same stance as whatsapp_config — RLS on, no policies).
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_ads_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,

  -- Long-lived user access token, AES-GCM encrypted via
  -- src/lib/whatsapp/encryption.ts (same helper whatsapp_config uses).
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,   -- ~60 days from exchange; null if Meta omits it

  fb_user_id TEXT,
  ad_account_id TEXT,             -- e.g. 'act_1234567890', chosen by the user
  page_id TEXT,                   -- Facebook Page used as the ad identity
  ig_account_id TEXT,             -- optional Instagram business account
  currency TEXT,                  -- from the ad account, e.g. 'INR' — display only

  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'token_expired', 'disconnected')),

  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_config_account ON meta_ads_config(account_id);

ALTER TABLE meta_ads_config ENABLE ROW LEVEL SECURITY;
