UPDATE public.contact_property_inquiries
  SET via_portal_link = TRUE,
      inquiry_source = CASE inquiry_source
        WHEN 'magicbricks' THEN 'Magic Bricks'
        WHEN 'housing' THEN 'Housing'
      END
  WHERE inquiry_source IN ('magicbricks', 'housing');

CREATE OR REPLACE FUNCTION public.clear_enquiry_portal_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.via_portal_link AND NEW.via_portal_link THEN
    NEW.via_portal_link := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_enquiry_portal_link ON public.contact_property_inquiries;
CREATE TRIGGER clear_enquiry_portal_link
  BEFORE UPDATE ON public.contact_property_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_enquiry_portal_link();

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

  DELETE FROM property_portal_listing_aliases ppla
    WHERE ppla.account_id = p_account_id
      AND ppla.portal = p_portal
      AND ppla.portal_listing_id = p_portal_listing_id
    RETURNING ppla.property_id INTO v_property_id;

  IF v_property_id IS NULL THEN
    UPDATE property_portal_listings ppl
      SET portal_listing_id = NULL
      WHERE ppl.account_id = p_account_id
        AND ppl.portal = p_portal
        AND ppl.portal_listing_id = p_portal_listing_id
      RETURNING ppl.property_id INTO v_property_id;
  END IF;

  IF v_property_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM contact_property_inquiries cpi
    WHERE cpi.property_id = v_property_id
      AND cpi.via_portal_link
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

REVOKE ALL ON FUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT) TO authenticated;
