-- ============================================================
-- Why a deal was lost.
--
-- Marking a deal lost now asks for a reason (price or terms
-- disagreement, owner or buyer backed out, legal or document issue,
-- financing, other) and an optional note, so failed deals can be read
-- back by cause. Both columns are cleared when the deal reopens.
--
-- Additive: two nullable columns and a trigger that only ever touches
-- them. Nothing reads them until the new app code does.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_note TEXT;

CREATE OR REPLACE FUNCTION clear_deal_lost_reason()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'lost' THEN
    NEW.lost_reason := NULL;
    NEW.lost_note := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_deal_lost_reason_trigger ON deals;
CREATE TRIGGER clear_deal_lost_reason_trigger
  BEFORE INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION clear_deal_lost_reason();
