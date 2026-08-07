-- ============================================================
-- 214_reengagement_notice_template.sql
-- Count batches sent on property_enquiry_notice as re-engagement.
--
-- property_enquiry_update was submitted as Utility and approved as
-- Marketing, so it is not usable for a batch that has to reach every
-- lead — Marketing templates are silently dropped at a recipient's
-- per-user cap. property_enquiry_notice replaces it: the same copy
-- Meta already approved as Utility for property_enquiry_status, plus a
-- line naming the enquired property, and without the "Send listings"
-- button that is the likeliest cause of the reclassification.
--
-- The old name stays in the list so a batch already sent on it keeps
-- appearing in the outcome report.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_reengagement_template(p_template_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_template_name IN (
    'property_enquiry_status',
    'property_enquiry_notice',
    'property_enquiry_update',
    'property_enquiry_followup'
  );
$$;
