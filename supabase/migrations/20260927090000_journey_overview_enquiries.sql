CREATE OR REPLACE FUNCTION public.journey_overview_enquiries(
  p_account_id UUID,
  p_mode TEXT
)
RETURNS TABLE (
  subject_id UUID,
  enquiry_count BIGINT,
  last_enquired_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_mode NOT IN ('buyer', 'property')
     OR NOT is_account_member(p_account_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH subjects AS (
    SELECT DISTINCT
      CASE
        WHEN p_mode = 'buyer' THEN items.contact_id
        ELSE items.property_id
      END AS id
    FROM journey_items items
    WHERE items.account_id = p_account_id
  ),
  enquiries AS (
    SELECT
      CASE
        WHEN p_mode = 'buyer' THEN inquiries.contact_id
        ELSE inquiries.property_id
      END AS id,
      COALESCE(inquiries.inquiry_date, inquiries.created_at) AS enquired_at
    FROM contact_property_inquiries inquiries
    WHERE inquiries.account_id = p_account_id
  )
  SELECT
    subjects.id,
    count(*),
    max(enquiries.enquired_at)
  FROM enquiries
  JOIN subjects ON subjects.id = enquiries.id
  GROUP BY subjects.id;
END;
$$;

REVOKE ALL ON FUNCTION public.journey_overview_enquiries(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journey_overview_enquiries(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.journey_overview_enquiries(UUID, TEXT) IS
  'Per-journey enquiry totals for the Journey overview sort: how many contact_property_inquiries rows a buyer (buyer mode) or a listing (property mode) has, and when the latest one was recorded. Only subjects that have a journey are returned.';
