-- ============================================================
-- 107_ad_campaigns.sql — Click-to-WhatsApp campaigns created from a
--   property (Meta Ads integration, Phase C).
--
-- One row per campaign we create through the Marketing API. Holds the
-- Meta object ids (campaign/adset/ad/creative), the local status
-- mirror, the budget/creative we launched with, and a cached copy of
-- the latest Insights numbers (refreshed by the Phase D dashboard).
--
-- ad_id joins back to ctwa_referrals.source_id so real CRM leads can
-- be counted per campaign (cost-per-lead). Service-role only — written
-- and read via the /api/meta-ads/* routes with the admin client;
-- RLS on with no policies, same stance as meta_ads_config.
-- ============================================================

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Meta object ids (strings).
  campaign_id TEXT NOT NULL,
  adset_id TEXT,
  ad_id TEXT,
  creative_id TEXT,

  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR')),

  daily_budget_minor INTEGER NOT NULL,   -- paise (Meta minor currency units)
  currency TEXT NOT NULL DEFAULT 'INR',

  headline TEXT,
  primary_text TEXT,
  image_url TEXT,                         -- which listing photo was used
  radius_km INTEGER,
  end_at TIMESTAMPTZ,                     -- optional scheduled stop

  created_by UUID,                        -- user_id who launched it
  last_insights JSONB,                    -- {spend, impressions, reach, conversations, fetched_at}
  last_insights_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_account ON ad_campaigns(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_ad_id ON ad_campaigns(account_id, ad_id);

-- At most one live (ACTIVE or PAUSED) campaign per property — keeps the
-- "Promote" UX unambiguous. Archived/errored rows don't count, so a
-- property can be re-promoted after a previous campaign is stopped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_campaigns_one_active_per_property
  ON ad_campaigns(property_id) WHERE status IN ('ACTIVE', 'PAUSED');

ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
