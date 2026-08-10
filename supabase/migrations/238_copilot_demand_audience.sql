-- ============================================================
-- 238_copilot_demand_audience.sql
--
-- The helper now answers three audiences — agency staff, property
-- owners in Portfolio, and buyers in Portfolio — and each asks for
-- different things. Recording only (account, capability) merged an
-- owner's "let me change the price myself" with an agent's identical
-- phrase into one row, which misreads the roadmap: those are two
-- different products wanting two different features.
--
-- audience joins the dedupe key so the three stay separate, and the
-- ranking query groups on it:
--
--   SELECT audience, capability_key,
--          min(capability)            AS capability,
--          count(DISTINCT account_id) AS accounts,
--          sum(request_count)         AS asks
--   FROM copilot_unmet_requests
--   GROUP BY audience, capability_key
--   ORDER BY accounts DESC, asks DESC;
--
-- Existing rows predate the portals, so they backfill to 'agent'.
--
-- NOTE: like 109 and 236, apply this in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE copilot_unmet_requests
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'agent'
    CHECK (audience IN ('agent', 'owner', 'buyer'));

-- The dedupe key gains the audience. Drop the old two-column unique
-- constraint (created inline by 236's UNIQUE(...)) before adding the
-- three-column one, or the upsert keeps conflicting on the old pair.
ALTER TABLE copilot_unmet_requests
  DROP CONSTRAINT IF EXISTS copilot_unmet_requests_account_id_capability_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS copilot_unmet_requests_account_audience_key
  ON copilot_unmet_requests (account_id, audience, capability_key);

-- Cross-tenant ranking is now per audience.
DROP INDEX IF EXISTS idx_copilot_unmet_capability;
CREATE INDEX IF NOT EXISTS idx_copilot_unmet_capability
  ON copilot_unmet_requests (audience, capability_key);

-- ------------------------------------------------------------
-- log_copilot_unmet_request: same upsert, now audience-aware.
-- p_audience defaults to 'agent' so any caller still on the old
-- five-argument signature keeps working.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_copilot_unmet_request(
  p_account_id UUID,
  p_capability TEXT,
  p_capability_key TEXT,
  p_question TEXT,
  p_pathname TEXT,
  p_audience TEXT DEFAULT 'agent'
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO copilot_unmet_requests AS u (
    account_id, capability, capability_key, sample_question, pathname, audience
  )
  VALUES (
    p_account_id, p_capability, p_capability_key, p_question, p_pathname,
    COALESCE(p_audience, 'agent')
  )
  ON CONFLICT (account_id, audience, capability_key) DO UPDATE
    SET request_count     = u.request_count + 1,
        last_requested_at = NOW();
$$;

GRANT EXECUTE ON FUNCTION log_copilot_unmet_request(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- The five-argument overload from 236 would still resolve for calls
-- that omit p_audience, leaving two functions that can drift. The
-- new one's DEFAULT covers those callers, so retire the old one.
DROP FUNCTION IF EXISTS log_copilot_unmet_request(UUID, TEXT, TEXT, TEXT, TEXT);
