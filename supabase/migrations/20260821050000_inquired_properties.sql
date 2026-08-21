-- ============================================================
-- 20260821050000_inquired_properties.sql
--
-- Which listings a contact actually enquired about, for the match rows
-- that offer that contact as a recipient. A name and a score say a lead
-- fits; what they asked about says why, and whether this share is a
-- follow-up or a cold approach.
--
-- Aggregated and capped in SQL, per §2.6 of AGENTS.md: a match list is
-- a per-property fan-out over every Buyer and Agent in the account, so
-- reading whole enquiry histories to slice them client-side grows with
-- the tenant. Only the most recent p_limit enquiries per contact travel.
--
-- SECURITY INVOKER for the same reason as
-- contacts_inquired_listing_types (migration 20260820152500): both a
-- member's RLS-scoped client and the service-role fan-outs call it, and
-- an is_account_member() guard would return nothing for the latter.
-- ============================================================

CREATE OR REPLACE FUNCTION public.contacts_inquired_properties(
  p_account_id UUID,
  p_contact_ids UUID[] DEFAULT NULL,
  p_limit INT DEFAULT 3
)
RETURNS TABLE (contact_id UUID, properties JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    ranked.contact_id,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', ranked.id,
        'title', ranked.title,
        'property_code', ranked.property_code,
        'listing_type', ranked.listing_type,
        'inquiry_date', ranked.inquiry_date,
        'inquiry_source', ranked.inquiry_source
      )
      ORDER BY ranked.inquiry_date DESC NULLS LAST
    )
  FROM (
    SELECT
      cpi.contact_id,
      p.id,
      p.title,
      p.property_code,
      p.listing_type,
      cpi.inquiry_date,
      cpi.inquiry_source,
      ROW_NUMBER() OVER (
        PARTITION BY cpi.contact_id
        ORDER BY cpi.inquiry_date DESC NULLS LAST
      ) AS rn
    FROM contact_property_inquiries cpi
    JOIN properties p ON p.id = cpi.property_id
    WHERE cpi.account_id = p_account_id
      AND (p_contact_ids IS NULL OR cpi.contact_id = ANY (p_contact_ids))
  ) AS ranked
  WHERE ranked.rn <= GREATEST(p_limit, 1)
  GROUP BY ranked.contact_id;
$$;

REVOKE ALL ON FUNCTION public.contacts_inquired_properties(UUID, UUID[], INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_inquired_properties(UUID, UUID[], INT) TO authenticated, service_role;
