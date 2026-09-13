ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS brokerage_paid_at TIMESTAMPTZ;

UPDATE pipeline_stages
SET name = 'Deal Closed/Won'
WHERE LOWER(TRIM(name)) IN ('closed won', 'closed/registered/won');

WITH paid_without_pending AS (
  SELECT paid.pipeline_id, paid.position
  FROM pipeline_stages paid
  WHERE LOWER(TRIM(paid.name)) = 'brokerage paid'
    AND NOT EXISTS (
      SELECT 1
      FROM pipeline_stages pending
      WHERE pending.pipeline_id = paid.pipeline_id
        AND LOWER(TRIM(pending.name)) = 'brokerage pending'
    )
)
UPDATE pipeline_stages stage
SET position = stage.position + 1
FROM paid_without_pending target
WHERE stage.pipeline_id = target.pipeline_id
  AND stage.position >= target.position;

INSERT INTO pipeline_stages (pipeline_id, name, position, color)
SELECT paid.pipeline_id, 'Brokerage Pending', paid.position - 1, '#f59e0b'
FROM pipeline_stages paid
WHERE LOWER(TRIM(paid.name)) = 'brokerage paid'
  AND NOT EXISTS (
    SELECT 1
    FROM pipeline_stages pending
    WHERE pending.pipeline_id = paid.pipeline_id
      AND LOWER(TRIM(pending.name)) = 'brokerage pending'
  );

WITH closed_without_collection AS (
  SELECT closed.pipeline_id, closed.position
  FROM pipeline_stages closed
  WHERE LOWER(TRIM(closed.name)) = 'deal closed/won'
    AND NOT EXISTS (
      SELECT 1
      FROM pipeline_stages paid
      WHERE paid.pipeline_id = closed.pipeline_id
        AND LOWER(TRIM(paid.name)) = 'brokerage paid'
    )
)
UPDATE pipeline_stages stage
SET position = stage.position + 2
FROM closed_without_collection target
WHERE stage.pipeline_id = target.pipeline_id
  AND stage.position > target.position;

INSERT INTO pipeline_stages (pipeline_id, name, position, color)
SELECT closed.pipeline_id, 'Brokerage Pending', closed.position + 1, '#f59e0b'
FROM pipeline_stages closed
WHERE LOWER(TRIM(closed.name)) = 'deal closed/won'
  AND NOT EXISTS (
    SELECT 1
    FROM pipeline_stages paid
    WHERE paid.pipeline_id = closed.pipeline_id
      AND LOWER(TRIM(paid.name)) = 'brokerage paid'
  );

INSERT INTO pipeline_stages (pipeline_id, name, position, color)
SELECT closed.pipeline_id, 'Brokerage Paid', closed.position + 2, '#16a34a'
FROM pipeline_stages closed
WHERE LOWER(TRIM(closed.name)) = 'deal closed/won'
  AND NOT EXISTS (
    SELECT 1
    FROM pipeline_stages paid
    WHERE paid.pipeline_id = closed.pipeline_id
      AND LOWER(TRIM(paid.name)) = 'brokerage paid'
  );

CREATE OR REPLACE FUNCTION sync_deal_brokerage_paid_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_stage_name TEXT;
BEGIN
  SELECT LOWER(TRIM(name))
  INTO target_stage_name
  FROM pipeline_stages
  WHERE id = NEW.stage_id;

  IF target_stage_name = 'brokerage paid' THEN
    NEW.brokerage_paid_at = COALESCE(NEW.brokerage_paid_at, NOW());
  ELSIF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.brokerage_paid_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_deal_brokerage_paid_at_trigger ON deals;
CREATE TRIGGER sync_deal_brokerage_paid_at_trigger
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW
  EXECUTE FUNCTION sync_deal_brokerage_paid_at();

UPDATE deals deal
SET status = CASE
  WHEN LOWER(TRIM(stage.name)) LIKE '%lost%' THEN 'lost'
  ELSE 'won'
END
FROM pipeline_stages stage
WHERE deal.stage_id = stage.id
  AND (
    LOWER(TRIM(stage.name)) LIKE '%lost%'
    OR LOWER(TRIM(stage.name)) LIKE '%won%'
    OR LOWER(TRIM(stage.name)) LIKE '%registered%'
    OR LOWER(TRIM(stage.name)) LIKE '%brokerage%'
  );

UPDATE deals deal
SET brokerage_paid_at = COALESCE(deal.updated_at, deal.created_at, NOW())
FROM pipeline_stages stage
WHERE deal.stage_id = stage.id
  AND LOWER(TRIM(stage.name)) = 'brokerage paid'
  AND deal.brokerage_paid_at IS NULL;

COMMENT ON COLUMN deals.brokerage_paid_at IS
  'Timestamp recorded when a deal enters the terminal Brokerage Paid stage; cleared when reopened.';
