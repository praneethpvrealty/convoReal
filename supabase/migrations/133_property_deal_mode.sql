-- ============================================================
-- 133_property_deal_mode.sql — owner-controlled "Deal Mode" flag.
--
-- Deal Mode is the owner's sell-readiness switch, set from the
-- Owners Den (or by staff on the owner's behalf):
--   * off        — not for open matching (default)
--   * soft       — quietly open to offers: enters the cross-tenant
--                  matching pool (masked), surfaces in buyers' Match
--                  Radar, but no proactive pushes
--   * aggressive — actively selling: matched buyers/agents are
--                  notified immediately on WhatsApp
--
-- The cross-tenant matching sweep (/api/cron/deal-mode-matching,
-- Phase 2) reads only published properties with deal_mode <> 'off',
-- hence the partial index.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS deal_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (deal_mode IN ('off', 'soft', 'aggressive')),
  ADD COLUMN IF NOT EXISTS deal_mode_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deal_mode_set_by TEXT
    CHECK (deal_mode_set_by IN ('owner', 'staff'));

CREATE INDEX IF NOT EXISTS idx_properties_deal_pool
  ON properties(deal_mode)
  WHERE deal_mode <> 'off' AND is_published = TRUE;
