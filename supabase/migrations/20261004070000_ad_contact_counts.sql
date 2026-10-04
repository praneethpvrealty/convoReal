-- 20261004070000_ad_contact_counts.sql
-- Distinct contacts per Click-to-WhatsApp ad for the Ads page "Leads in
-- Engine" column, counted in SQL so the result does not depend on how
-- many referral rows PostgREST would return.

CREATE OR REPLACE FUNCTION public.ad_contact_counts(
  p_account_id UUID,
  p_ad_ids TEXT[],
  p_since TIMESTAMPTZ
)
RETURNS TABLE (
  source_id TEXT,
  contacts BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.source_id, count(DISTINCT r.contact_id)
  FROM ctwa_referrals r
  WHERE r.account_id = p_account_id
    AND r.source_id = ANY(p_ad_ids)
    AND r.created_at >= p_since
    AND is_account_member(p_account_id, 'viewer')
  GROUP BY r.source_id;
$$;

COMMENT ON FUNCTION public.ad_contact_counts(UUID, TEXT[], TIMESTAMPTZ) IS
  'Distinct contacts per ad from ctwa_referrals since a cutoff, for one account. Replaces fetching every referral row and deduplicating in the Ads route.';

REVOKE ALL ON FUNCTION public.ad_contact_counts(UUID, TEXT[], TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ad_contact_counts(UUID, TEXT[], TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.ad_contact_counts(UUID, TEXT[], TIMESTAMPTZ) TO authenticated;
