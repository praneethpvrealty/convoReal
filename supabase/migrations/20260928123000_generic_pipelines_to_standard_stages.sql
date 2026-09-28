-- ============================================================
-- Move the generic "Sales Pipeline" stage list to the standard stages.
--
-- 20260928094000 moved every pipeline on the old real-estate stages to
-- the "done → next" sequence and left pipelines with any other stage
-- list alone. Three pipelines still carry the generic list (New Lead,
-- Qualified, Proposal Sent, Negotiation, Won) and have no Closed Lost
-- stage at all. This brings them onto the same nine stages.
--
-- The five existing stages are updated in place, keeping their ids, so
-- any deal, journey mirror or history attached to them stays attached:
-- New Lead, Qualified, Proposal Sent and Negotiation become the first
-- four open stages, and Won becomes "Registered → Brokerage" so a won
-- deal stays won. The four missing stages are added. Only a pipeline
-- whose stages are exactly the generic list is touched, so a re-run or
-- a pipeline someone has since edited is left alone.
--
-- Not additive: it rewrites stage rows, so it is applied only once the
-- pull request that carries it is merged.
-- ============================================================

DO $$
DECLARE
  v_generic TEXT[] := ARRAY['New Lead', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won'];
  v_renamed TEXT[] := ARRAY[
    'Enquiry → Shortlist', 'Shortlisted → Visit', 'Finalised → Owner''s meeting',
    'Owner''s meeting → Negotiation', 'Registered → Brokerage'
  ];
  v_renamed_type TEXT[] := ARRAY['open', 'open', 'open', 'open', 'brokerage_pending'];
  v_renamed_color TEXT[] := ARRAY['#3b82f6', '#eab308', '#f97316', '#8b5cf6', '#f59e0b'];
  v_renamed_position INTEGER[] := ARRAY[0, 1, 2, 3, 6];
  p RECORD;
  v_stage_ids UUID[];
  v_prop RECORD;
  i INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  FOR p IN
    SELECT pl.id, pl.account_id
      FROM pipelines pl
      WHERE (
        SELECT array_agg(s.name ORDER BY s.position)
          FROM pipeline_stages s
          WHERE s.pipeline_id = pl.id
      ) = v_generic
  LOOP
    SELECT array_agg(s.id ORDER BY s.position)
      INTO v_stage_ids
      FROM pipeline_stages s
      WHERE s.pipeline_id = p.id;

    FOR i IN 1..5 LOOP
      UPDATE pipeline_stages
        SET name = v_renamed[i],
            stage_type = v_renamed_type[i],
            color = v_renamed_color[i],
            position = v_renamed_position[i]
        WHERE id = v_stage_ids[i];
    END LOOP;

    INSERT INTO pipeline_stages (pipeline_id, name, color, position, stage_type) VALUES
      (p.id, 'Deal confirmed → Due diligence', '#06b6d4', 4, 'committed'),
      (p.id, 'Legal done → Agreement/Registration', '#14b8a6', 5, 'committed'),
      (p.id, 'Brokerage paid / Closed', '#16a34a', 7, 'brokerage_paid'),
      (p.id, 'Closed Lost', '#ef4444', 8, 'lost');

    IF p.id = (
      SELECT id FROM pipelines
        WHERE account_id = p.account_id
        ORDER BY created_at
        LIMIT 1
    ) THEN
      PERFORM journey_stages_mirror_pipeline(p.account_id, p.id);
    END IF;

    FOR v_prop IN
      SELECT DISTINCT d.property_id
        FROM deals d
        WHERE d.pipeline_id = p.id
          AND d.account_id = p.account_id
          AND d.property_id IS NOT NULL
          AND d.status IN ('open', 'won')
    LOOP
      PERFORM sync_listing_status_from_deals(p.account_id, v_prop.property_id, 'Available');
    END LOOP;
  END LOOP;
END;
$$;
