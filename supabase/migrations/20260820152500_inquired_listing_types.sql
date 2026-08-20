-- ============================================================
-- 20260820152500_inquired_listing_types.sql
--
-- Listing intent derived from what a contact actually enquired about.
-- src/lib/matching.ts falls back to it when a lead never stated an
-- intent, so a lease stops reaching leads who have only ever asked
-- about properties for sale.
--
-- Aggregated in SQL, per §2.6 of AGENTS.md: the alternative is reading
-- an account's whole enquiry history plus every joined property into
-- the client to reduce it there, which grows without bound. The
-- contact filter travels as an array argument in the RPC body rather
-- than as a PostgREST `in.()` list in the URL.
--
-- SECURITY INVOKER on purpose — unusually for an aggregate here. Both
-- kinds of caller must work: a member's browser/SSR client, which RLS
-- scopes through migration 259's membership policy, and the
-- service-role fan-outs (Radar, buyer digest, buyer portal), which
-- have no auth.uid() and would get zero rows from an
-- is_account_member() guard.
--
-- The WhatsApp Flow writer (src/lib/flows/engine.ts) never set
-- account_id, so those rows were invisible to the membership policy
-- and to this function's filter. Fixed in the same change; the
-- backfill below clears the rows it already wrote.
-- ============================================================

UPDATE contact_property_inquiries AS cpi
SET account_id = c.account_id
FROM contacts AS c
WHERE c.id = cpi.contact_id
  AND cpi.account_id IS NULL;

CREATE OR REPLACE FUNCTION public.contacts_inquired_listing_types(
  p_account_id UUID,
  p_contact_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (contact_id UUID, listing_types TEXT[])
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT cpi.contact_id, ARRAY_AGG(DISTINCT p.listing_type)
  FROM contact_property_inquiries cpi
  JOIN properties p ON p.id = cpi.property_id
  WHERE cpi.account_id = p_account_id
    AND p.listing_type IS NOT NULL
    AND (p_contact_ids IS NULL OR cpi.contact_id = ANY (p_contact_ids))
  GROUP BY cpi.contact_id;
$$;

REVOKE ALL ON FUNCTION public.contacts_inquired_listing_types(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_inquired_listing_types(UUID, UUID[]) TO authenticated, service_role;
