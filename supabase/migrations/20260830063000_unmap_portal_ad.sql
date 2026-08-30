-- ============================================================
-- 20260830063000_unmap_portal_ad.sql
-- Undo a portal ad -> listing mapping in one transaction.
--
-- The mapping (POST /api/contacts/[id]/portal-link) writes three
-- things: the ad id onto a property_portal_listings row, a pointer on
-- every contact waiting on that ad, and a junction row per contact.
-- Undoing it as three round trips leaves the ad released but the
-- contacts still tagged when the second call fails, and the retry
-- finds no link to work from. It also has to name the contacts in an
-- `.in()` list that grows with the backlog and travels in the URL.
--
-- One function fixes both: the correction commits or it does not, and
-- the contacts are reached by a correlated predicate instead of a list.
--
-- Only junction rows the mapping itself created are removed —
-- inquiry_source names the portal, so a manual or showcase interest in
-- the same property keeps its row and its date.
-- ============================================================

CREATE OR REPLACE FUNCTION public.unmap_portal_ad(
  p_account_id UUID,
  p_portal TEXT,
  p_portal_listing_id TEXT
)
RETURNS TABLE (
  property_id UUID,
  untagged_contacts BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id UUID;
  v_untagged BIGINT;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not a member of this account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE property_portal_listings ppl
    SET portal_listing_id = NULL
    WHERE ppl.account_id = p_account_id
      AND ppl.portal = p_portal
      AND ppl.portal_listing_id = p_portal_listing_id
    RETURNING ppl.property_id INTO v_property_id;

  IF v_property_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM contact_property_inquiries cpi
    WHERE cpi.property_id = v_property_id
      AND cpi.inquiry_source = p_portal
      AND EXISTS (
        SELECT 1 FROM contacts c
        WHERE c.id = cpi.contact_id
          AND c.account_id = p_account_id
          AND c.lead_portal = p_portal
          AND c.lead_portal_listing_id = p_portal_listing_id
          AND c.last_inquired_property_id = v_property_id
      );

  WITH cleared AS (
    UPDATE contacts c
      SET last_inquired_property_id = NULL,
          updated_at = NOW()
      WHERE c.account_id = p_account_id
        AND c.lead_portal = p_portal
        AND c.lead_portal_listing_id = p_portal_listing_id
        AND c.last_inquired_property_id = v_property_id
      RETURNING c.id
  )
  SELECT count(*) INTO v_untagged FROM cleared;

  RETURN QUERY SELECT v_property_id, v_untagged;
END;
$$;

COMMENT ON FUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT) IS
  'Release a portal ad id from its listing and undo the tagging that mapping applied, atomically.';

REVOKE ALL ON FUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT) TO authenticated;
