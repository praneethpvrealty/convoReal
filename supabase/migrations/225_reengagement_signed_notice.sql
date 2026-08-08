-- enquiry_status_notice joins the re-engagement family.
--
-- property_enquiry_status names nobody: it reaches imported portal
-- leads who have never messaged this number, so it arrives from an
-- unknown sender claiming to know about "your property enquiry". The
-- signed revision opens with the brokerage's own name. Meta will not
-- re-review an approved template in place, so it ships under a new
-- name with the old one kept as the fallback — which means BOTH have
-- to count as a re-engagement batch for the outcome panel to appear.
--
-- Keep in sync with REENGAGEMENT_TEMPLATE_NAMES in
-- src/lib/reengagement/funnel.ts.

CREATE OR REPLACE FUNCTION public.is_reengagement_template(p_template_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_template_name IN (
    'enquiry_status_notice',
    'property_enquiry_status',
    'property_enquiry_notice',
    'property_enquiry_update',
    'property_enquiry_followup'
  );
$$;
