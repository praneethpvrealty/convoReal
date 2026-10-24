-- ============================================================
-- 20261024110100_followup_closed_listing_contact_answers.sql
--
-- The follow-up radar skips a lead who closed their last-enquired
-- listing themselves. Since 20261024090000 an agent can also mark a
-- contact "Not a fit" for a listing; that says the listing does not
-- suit them, not that they closed their enquiry, so only the
-- contact's own rejection counts here.
--
-- Replaces an existing function: applied after the PR merges.
-- ============================================================

CREATE OR REPLACE FUNCTION public.followup_closed_listing_contacts(
  p_account_id uuid,
  p_contact_ids uuid[]
)
RETURNS TABLE (contact_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.id
  FROM contacts c
  JOIN listing_feedback lf
    ON lf.contact_id = c.id
   AND lf.property_id = c.last_inquired_property_id
   AND lf.account_id = p_account_id
   AND lf.verdict = 'rejected'
   AND lf.source = 'contact'
  WHERE c.account_id = p_account_id
    AND c.id = ANY (p_contact_ids);
$$;

REVOKE ALL ON FUNCTION public.followup_closed_listing_contacts(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.followup_closed_listing_contacts(uuid, uuid[]) TO service_role;
