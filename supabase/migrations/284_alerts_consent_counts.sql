-- ============================================================
-- 284_alerts_consent_counts.sql
--
-- The greeting send sheet shows how many contacts have explicitly
-- opted in, so an agent can see whether an opted-in-only send will
-- reach anyone. Both surfaces were computing that with a PostgREST
-- `count: 'exact'` from the client — a real COUNT(*) over the
-- account's contacts, fired on every open of the sheet, on every
-- device. §2.6 of AGENTS.md forbids exactly that.
--
-- One scan returns all three states rather than one count per state,
-- so a screen that later shows the full breakdown costs no more than
-- this one does. Guarded by is_account_member(), like every other
-- SECURITY DEFINER aggregate here: the function names its account and
-- returns nothing to a caller who is not a member of it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.account_alerts_consent_counts(
  p_account_id UUID
)
RETURNS TABLE (pending BIGINT, granted BIGINT, declined BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE c.buyer_alerts_consent = 'pending')  AS pending,
    COUNT(*) FILTER (WHERE c.buyer_alerts_consent = 'granted')  AS granted,
    COUNT(*) FILTER (WHERE c.buyer_alerts_consent = 'declined') AS declined
  FROM contacts c
  WHERE c.account_id = p_account_id
    AND public.is_account_member(p_account_id)
    AND COALESCE(c.is_merged, FALSE) = FALSE;
$$;

REVOKE ALL ON FUNCTION public.account_alerts_consent_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_alerts_consent_counts(UUID) TO authenticated;
