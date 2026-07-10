-- ============================================================
-- 105_ctwa_referrals.sql — Click-to-WhatsApp ad attribution
--   (Meta Ads integration, Phase A).
--
-- When a buyer taps a Click-to-WhatsApp (CTWA) ad on Instagram/
-- Facebook and messages the agent's WhatsApp business number, Meta
-- attaches a `referral` object to that FIRST inbound message
-- (source ad id, headline, click id, creative). The webhook records
-- it here so the agent can see which ad produced each lead, and — once
-- Phase C exists — join spend to real CRM leads for cost-per-lead.
--
-- Service-role only: written by the webhook handler and read by authed
-- API routes, both via the admin client. RLS on with no policies so
-- anon/authenticated are denied by default; service_role bypasses.
--
-- NOTE: repo migration numbering has a pre-existing duplicate at 103
-- (103_razorpay_orders.sql + 103_update_starter_limits.sql) from
-- concurrent work; 104 is already taken, so this correctly continues
-- at 105. The 103 duplication is unrelated and left for the owner.
-- ============================================================

CREATE TABLE IF NOT EXISTS ctwa_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- Meta message id of the first inbound (ad-originated) message.
  message_id TEXT,

  source_type TEXT,   -- 'ad' | 'post'
  source_id TEXT,     -- the ad id; joins to ad_campaigns.ad_id once Phase C exists
  source_url TEXT,
  headline TEXT,
  body TEXT,
  media_type TEXT,
  image_url TEXT,
  video_url TEXT,
  ctwa_clid TEXT,     -- click id, kept for a future Conversions API step

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: a redelivered webhook carries the same Meta message id;
-- the unique index lets the insert no-op instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ctwa_referrals_message
  ON ctwa_referrals(message_id) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ctwa_referrals_account
  ON ctwa_referrals(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctwa_referrals_contact
  ON ctwa_referrals(contact_id);
CREATE INDEX IF NOT EXISTS idx_ctwa_referrals_source
  ON ctwa_referrals(account_id, source_id);

ALTER TABLE ctwa_referrals ENABLE ROW LEVEL SECURITY;
