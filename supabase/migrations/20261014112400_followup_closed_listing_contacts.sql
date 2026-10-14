-- ============================================================
-- 20261014112400_followup_closed_listing_contacts.sql — the leads whose
-- last-enquired listing they closed themselves.
--
-- The follow-up radar skips a lead whose last_inquired_property_id they
-- rejected with "Close my enquiry". Reading listing_feedback through
-- PostgREST meant passing every quiet lead's id in the request URL, which
-- fails on a large account and would let a closed listing be carded again.
-- The ids travel in the RPC body instead, and the join happens here.
--
-- Additive: a new function only. Service role only, like the radar's
-- other functions.
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
  WHERE c.account_id = p_account_id
    AND c.id = ANY (p_contact_ids);
$$;

REVOKE ALL ON FUNCTION public.followup_closed_listing_contacts(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.followup_closed_listing_contacts(uuid, uuid[]) TO service_role;
