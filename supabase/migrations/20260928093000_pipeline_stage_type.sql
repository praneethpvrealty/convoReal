-- ============================================================
-- Pipeline stages carry what they mean, not only what they are called.
--
-- Listing status, deal outcome, brokerage capture and the journey kind
-- were all read out of words in a stage's name, so renaming a stage
-- silently changed its behaviour. stage_type records the meaning once:
--
--   open               still working; the listing stays Available
--   committed          deal confirmed; the listing is Under Contract
--   won                closed; the listing is Sold
--   brokerage_pending  closed, brokerage still to collect
--   brokerage_paid     closed and brokerage received
--   lost               the deal fell through
--
-- Additive: a new column filled from the current names by the same
-- words the app and the database use today, so every existing stage
-- keeps its behaviour. A stage written without a type (an older client,
-- a seed that predates the column) gets one inferred from its name.
-- ============================================================

-- Mirrors inferStageType in src/lib/pipelines/stage-semantics.ts.
CREATE OR REPLACE FUNCTION pipeline_stage_type_from_name(stage_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN n LIKE '%lost%' THEN 'lost'
    WHEN n LIKE '%brokerage%' AND n LIKE '%paid%' THEN 'brokerage_paid'
    WHEN n LIKE '%brokerage%' THEN 'brokerage_pending'
    WHEN n LIKE '%won%' OR n LIKE '%registered%' THEN 'won'
    WHEN n LIKE '%negotiation%' OR n LIKE '%token%'
      OR n LIKE '%due diligence%' OR n LIKE '%contract%'
      OR n LIKE '%confirmed%' OR n LIKE '%agreement%' THEN 'committed'
    ELSE 'open'
  END
  FROM (SELECT lower(btrim(COALESCE(stage_name, ''))) AS n) s;
$$;

ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS stage_type TEXT;

UPDATE pipeline_stages
  SET stage_type = pipeline_stage_type_from_name(name)
  WHERE stage_type IS NULL;

CREATE OR REPLACE FUNCTION pipeline_stage_default_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_type IS NULL THEN
    NEW.stage_type := pipeline_stage_type_from_name(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_stage_default_type_trigger ON pipeline_stages;
CREATE TRIGGER pipeline_stage_default_type_trigger
  BEFORE INSERT OR UPDATE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION pipeline_stage_default_type();

ALTER TABLE pipeline_stages ALTER COLUMN stage_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_stage_type_check'
  ) THEN
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT pipeline_stages_stage_type_check
      CHECK (stage_type IN (
        'open', 'committed', 'won', 'brokerage_pending', 'brokerage_paid', 'lost'
      ));
  END IF;
END;
$$;

-- Mirrors journeyStageKindForPipelineStage in
-- src/lib/pipelines/stage-semantics.ts.
CREATE OR REPLACE FUNCTION journey_stage_kind_for_stage_type(p_stage_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_stage_type
    WHEN 'lost' THEN 'lost'
    WHEN 'won' THEN 'won'
    WHEN 'brokerage_pending' THEN 'won'
    WHEN 'brokerage_paid' THEN 'won'
    WHEN 'committed' THEN 'closing'
    ELSE 'prospecting'
  END;
$$;
