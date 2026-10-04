-- ============================================================
-- Prices of the listings a contact enquired about.
--
-- A portal lead's pref_budget_max is seeded from the price of the
-- listing they enquired about (src/app/api/leads/email-webhook). That
-- is a ceiling the lead was willing to look at, not a budget they
-- stated, so src/lib/matching.ts must not read half of it as a floor:
-- a ₹14.7 Cr enquirer who then asks for Horamavu was shown nothing
-- under ₹7.35 Cr there. The matcher recognises the anchor by comparing
-- the budget against these prices.
--
-- Aggregated in SQL and called with the contact ids in the RPC body,
-- for the same reasons as contacts_inquired_listing_types (migration
-- 20260820152500), and SECURITY INVOKER for the same reason: both a
-- member's RLS-scoped client and the service-role fan-outs call it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.contacts_inquired_prices(
  p_account_id UUID,
  p_contact_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (contact_id UUID, prices NUMERIC[])
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT cpi.contact_id, ARRAY_AGG(DISTINCT p.price)
  FROM contact_property_inquiries cpi
  JOIN properties p ON p.id = cpi.property_id
  WHERE cpi.account_id = p_account_id
    AND p.price > 0
    AND (p_contact_ids IS NULL OR cpi.contact_id = ANY (p_contact_ids))
  GROUP BY cpi.contact_id;
$$;

REVOKE ALL ON FUNCTION public.contacts_inquired_prices(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_inquired_prices(UUID, UUID[]) TO authenticated, service_role;
