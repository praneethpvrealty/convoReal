-- Listings explicitly shared to a phone number can follow that person into
-- a newly-created ConvoReal account. The service-role-only lookup is used by
-- the existing inventory sync after the account's WhatsApp number is verified.
CREATE OR REPLACE FUNCTION public.find_property_shares_for_phone(
  p_phone_last10 TEXT
)
RETURNS TABLE (property_id UUID, account_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ps.property_id, ps.account_id
  FROM property_shares ps
  JOIN contacts c
    ON c.id = ps.contact_id
   AND c.account_id = ps.account_id
  JOIN properties p
    ON p.id = ps.property_id
   AND p.account_id = ps.account_id
  WHERE p_phone_last10 <> ''
    AND right(
      regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'),
      10
    ) = p_phone_last10
    AND p.is_published = TRUE;
$$;

REVOKE ALL ON FUNCTION public.find_property_shares_for_phone(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_property_shares_for_phone(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_property_shares_for_phone(TEXT) TO service_role;

COMMENT ON FUNCTION public.find_property_shares_for_phone(TEXT) IS
  'Service-role lookup for published properties explicitly shared to a verified phone. Used to place attributed copies in a newly onboarded account review queue.';
