-- ============================================================
-- Backfill: every account's journey stages become mirrors of its
-- default pipeline, and existing journey items are re-pointed.
--
-- Held until the code that reads mirrored stages is on main: this
-- rewrites journey_items.stage_id, which the old journey page would
-- otherwise show against stages it no longer lists.
--
-- ensure_default_pipeline (…120050) gives a stage-less default board
-- the standard stages, so every account mirrors something; the guard
-- below only stands in case that ever fails.
--
-- Order matters: a converted item follows its deal first (the deal is
-- the closing record; one on another board lands on the mirrored
-- stage of the same kind, and the trigger from …120050 leaves that
-- deal where it is), then the rest map by stage kind onto the first
-- mirrored stage of that kind. A mirror of any other pipeline (the
-- first sync function accepted one) has its items re-pointed by kind
-- onto the default board's mirror and is removed with the legacy
-- stages: every item is on a default-board mirror by now, and a stage
-- note keeps its own name and colour snapshot (its stage_id FK is ON
-- DELETE SET NULL), so no stray stage is left for a lookup to find.
-- ============================================================

DO $$
DECLARE
  acc RECORD;
  v_pipeline UUID;
BEGIN
  FOR acc IN
    SELECT a.id
      FROM accounts a
      WHERE EXISTS (SELECT 1 FROM journey_stages js WHERE js.account_id = a.id)
         OR EXISTS (SELECT 1 FROM pipelines p WHERE p.account_id = a.id)
  LOOP
    v_pipeline := ensure_default_pipeline(acc.id);
    IF v_pipeline IS NULL THEN
      CONTINUE;
    END IF;
    PERFORM journey_stages_mirror_pipeline(acc.id, v_pipeline);
    IF NOT EXISTS (
      SELECT 1 FROM journey_stages
        WHERE account_id = acc.id AND pipeline_stage_id IS NOT NULL
    ) THEN
      CONTINUE;
    END IF;

    UPDATE journey_items ji
      SET stage_id = js.id
      FROM deals d
      JOIN journey_stages js
        ON js.pipeline_stage_id = d.stage_id AND js.account_id = d.account_id
      WHERE d.source_journey_item_id = ji.id
        AND d.account_id = acc.id
        AND ji.account_id = acc.id
        AND ji.stage_id IS DISTINCT FROM js.id;

    UPDATE journey_items ji
      SET stage_id = m.id
      FROM deals d
      JOIN pipeline_stages dps ON dps.id = d.stage_id
      CROSS JOIN LATERAL (
        SELECT js.id FROM journey_stages js
          WHERE js.account_id = acc.id
            AND js.pipeline_stage_id IS NOT NULL
            AND js.stage_kind = journey_stage_kind_for_pipeline_stage(dps.name)
          ORDER BY js.position
          LIMIT 1
      ) m
      WHERE d.source_journey_item_id = ji.id
        AND d.account_id = acc.id
        AND ji.account_id = acc.id
        AND d.pipeline_id <> v_pipeline
        AND ji.stage_id IS DISTINCT FROM m.id;

    UPDATE journey_items ji
      SET stage_id = m.id
      FROM journey_stages legacy
      CROSS JOIN LATERAL (
        SELECT js.id FROM journey_stages js
          WHERE js.account_id = acc.id
            AND js.pipeline_stage_id IS NOT NULL
            AND js.stage_kind = legacy.stage_kind
          ORDER BY js.position
          LIMIT 1
      ) m
      WHERE ji.account_id = acc.id
        AND ji.stage_id = legacy.id
        AND legacy.account_id = acc.id
        AND legacy.pipeline_stage_id IS NULL;

    UPDATE journey_items ji
      SET stage_id = (
        SELECT js.id FROM journey_stages js
          WHERE js.account_id = acc.id AND js.pipeline_stage_id IS NOT NULL
          ORDER BY js.position
          LIMIT 1
      )
      WHERE ji.account_id = acc.id
        AND ji.stage_id IN (
          SELECT id FROM journey_stages
            WHERE account_id = acc.id AND pipeline_stage_id IS NULL
        );

    UPDATE journey_items ji
      SET stage_id = m.id
      FROM journey_stages foreign_js
      JOIN pipeline_stages fps ON fps.id = foreign_js.pipeline_stage_id
      CROSS JOIN LATERAL (
        SELECT js.id FROM journey_stages js
          JOIN pipeline_stages ps ON ps.id = js.pipeline_stage_id
          WHERE js.account_id = acc.id
            AND ps.pipeline_id = v_pipeline
            AND js.stage_kind = foreign_js.stage_kind
          ORDER BY js.position
          LIMIT 1
      ) m
      WHERE ji.account_id = acc.id
        AND ji.stage_id = foreign_js.id
        AND foreign_js.account_id = acc.id
        AND fps.pipeline_id <> v_pipeline;

    UPDATE journey_items
      SET planned_stage_id = NULL, planned_at = NULL
      WHERE account_id = acc.id
        AND planned_stage_id IN (
          SELECT s.id FROM journey_stages s
            LEFT JOIN pipeline_stages ps ON ps.id = s.pipeline_stage_id
            WHERE s.account_id = acc.id
              AND (s.pipeline_stage_id IS NULL OR ps.pipeline_id <> v_pipeline)
        );

    DELETE FROM journey_stages s
      USING (
        SELECT s2.id FROM journey_stages s2
          LEFT JOIN pipeline_stages ps ON ps.id = s2.pipeline_stage_id
          WHERE s2.account_id = acc.id
            AND (s2.pipeline_stage_id IS NULL OR ps.pipeline_id <> v_pipeline)
      ) gone
      WHERE s.id = gone.id
        AND NOT EXISTS (
          SELECT 1 FROM journey_items i
            WHERE i.stage_id = s.id OR i.planned_stage_id = s.id
        );
  END LOOP;
END $$;
