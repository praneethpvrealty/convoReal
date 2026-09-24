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
    WITH lost_stage AS (
      SELECT stages.id
      FROM journey_stages stages
      WHERE stages.account_id = p_account_id
        AND stages.stage_kind = 'lost'
        AND stages.pipeline_stage_id IS NOT NULL
      ORDER BY stages.position, stages.id
      LIMIT 1
    ),
    grouped AS (
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
          'furthest_stage_id', CASE
            WHEN grouped.active_count = 0 AND grouped.dropped_count > 0
              THEN COALESCE(
                (SELECT lost_stage.id FROM lost_stage),
                grouped.furthest_stage_id
              )
            ELSE grouped.furthest_stage_id
          END,
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
     AND (
       EXISTS (
         SELECT 1 FROM profiles profile
         WHERE profile.user_id = (SELECT auth.uid())
           AND profile.account_id = contacts.account_id
           AND profile.org_role IN ('org_manager', 'org_coordinator')
       )
       OR contacts.assigned_agent_id = (SELECT auth.uid())
       OR (
         contacts.assigned_team_id IS NOT NULL
         AND contacts.assigned_team_id = (
           SELECT profile.team_id FROM profiles profile
           WHERE profile.user_id = (SELECT auth.uid())
             AND profile.account_id = contacts.account_id
         )
       )
       OR (
         contacts.assigned_agent_id IS NULL
         AND contacts.assigned_team_id IS NULL
         AND EXISTS (
           SELECT 1 FROM profiles profile
           WHERE profile.user_id = (SELECT auth.uid())
             AND profile.account_id = contacts.account_id
             AND profile.org_role IN ('org_manager', 'org_leader')
         )
       )
     )
    LEFT JOIN properties
      ON p_mode = 'property'
     AND properties.id = grouped.subject_id
     AND properties.account_id = p_account_id
  );
END;
$$;

COMMENT ON FUNCTION public.journey_overview_groups(UUID, TEXT) IS
  'Account-scoped buyer/property Journey summaries. A journey whose visible items are all dropped is classified at the account''s lost stage. Contact identity fields preserve the caller-visible contacts_select team and assignment scope.';
