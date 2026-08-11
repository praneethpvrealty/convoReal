-- ============================================================
-- 245_copilot_events.sql — copilot adoption metering.
--
-- One append-only row per helper interaction: a chat answer (with
-- its platform and coverage verdict), a guided tour starting or
-- completing, a help-desk ticket filed. Aggregated this answers
-- "how many people actually use the copilot, where" — per platform
-- (web / mobile), per audience (agent / owner / buyer) — which the
-- AI call log cannot: tour matches and cache hits never reach
-- Gemini, and tours started from the Guides list never reach it at
-- all.
--
-- Written only by service-role code (src/lib/copilot/events.ts);
-- account admins can read their own team's rows. Platform-wide
-- numbers come from copilot_usage_summary() through the super-admin
-- route, same posture as bug reports and support tickets.
--
-- Like 109/236/244, apply in the Supabase SQL Editor.
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS copilot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  audience TEXT NOT NULL DEFAULT 'agent'
    CHECK (audience IN ('agent', 'owner', 'buyer')),
  platform TEXT NOT NULL DEFAULT 'web'
    CHECK (platform IN ('web', 'mobile')),
  event TEXT NOT NULL
    CHECK (event IN ('chat', 'tour_start', 'tour_complete', 'support_ticket')),

  tour_id TEXT,
  -- Chat answers only: the mobile coverage verdict and whether the
  -- learned cache served it (a cache hit is still usage).
  coverage TEXT,
  cached BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copilot_events_account_time
  ON copilot_events (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_events_rollup
  ON copilot_events (created_at, event, platform);

DROP TRIGGER IF EXISTS set_updated_at ON copilot_events;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON copilot_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE copilot_events ENABLE ROW LEVEL SECURITY;

-- Admins may read their own team's usage; writes arrive only through
-- service-role code (no client INSERT policy).
DROP POLICY IF EXISTS copilot_events_select ON copilot_events;
CREATE POLICY copilot_events_select ON copilot_events FOR SELECT USING (
  is_account_member(account_id, 'admin')
);

COMMENT ON TABLE copilot_events IS
  'Copilot adoption log: one row per chat answer, tour start/complete or support ticket, tagged with platform and audience. Aggregate with copilot_usage_summary(); never rendered row-by-row to tenants.';

-- ------------------------------------------------------------
-- copilot_usage_summary: the platform-wide rollup, aggregated in SQL
-- so the admin route never pages raw event rows.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION copilot_usage_summary(p_since TIMESTAMPTZ)
RETURNS TABLE(
  event TEXT,
  platform TEXT,
  audience TEXT,
  events BIGINT,
  users BIGINT,
  accounts BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    e.event,
    e.platform,
    e.audience,
    count(*)                    AS events,
    count(DISTINCT e.user_id)   AS users,
    count(DISTINCT e.account_id) AS accounts
  FROM copilot_events e
  WHERE e.created_at >= p_since
  GROUP BY e.event, e.platform, e.audience
  ORDER BY e.event, e.platform, e.audience;
$$;

REVOKE ALL ON FUNCTION copilot_usage_summary(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copilot_usage_summary(TIMESTAMPTZ) TO service_role;
