CREATE OR REPLACE FUNCTION public.journey_overview_groups(
  p_account_id UUID,
  p_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_mode NOT IN ('buyer', 'property')
     OR NOT is_account_member(p_account_id) THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    WITH grouped AS (
      SELECT
        CASE
          WHEN p_mode = 'buyer' THEN items.contact_id
          ELSE items.property_id
        END AS subject_id,
        count(*) FILTER (
          WHERE NOT items.hidden AND items.status = 'active'
        ) AS active_count,
        count(*) FILTER (
          WHERE NOT items.hidden AND items.status = 'dropped'
        ) AS dropped_count,
        count(*) FILTER (WHERE items.hidden) AS captured_count,
        (array_agg(stages.id ORDER BY stages.position DESC))[1]
          AS furthest_stage_id,
        max(items.updated_at) AS last_updated
      FROM journey_items items
      JOIN journey_stages stages
        ON stages.id = items.stage_id
       AND stages.account_id = p_account_id
      WHERE items.account_id = p_account_id
      GROUP BY 1
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'subject_id', grouped.subject_id,
          'active_count', grouped.active_count,
          'dropped_count', grouped.dropped_count,
          'captured_count', grouped.captured_count,
          'furthest_stage_id', grouped.furthest_stage_id,
          'last_updated', grouped.last_updated,
          'contact_name', contacts.name,
          'contact_phone', contacts.phone,
          'contact_name_tag', contacts.name_tag,
          'property_title', properties.title,
          'property_code', properties.property_code,
          'property_location', properties.location
        )
        ORDER BY grouped.subject_id
      ),
      '[]'::JSONB
    )
    FROM grouped
    LEFT JOIN contacts
      ON p_mode = 'buyer'
     AND contacts.id = grouped.subject_id
     AND contacts.account_id = p_account_id
    LEFT JOIN properties
      ON p_mode = 'property'
     AND properties.id = grouped.subject_id
     AND properties.account_id = p_account_id
  );
END;
$$;

COMMENT ON FUNCTION public.journey_overview_groups(UUID, TEXT) IS
  'Account-scoped buyer/property Journey summaries. Returns one JSON object per subject from one SQL snapshot so overview payloads grow with journeys, not journey-item history.';

REVOKE ALL ON FUNCTION public.journey_overview_groups(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journey_overview_groups(UUID, TEXT)
  TO authenticated;
