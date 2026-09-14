-- ============================================================
-- 20260914121500_deal_close_date_trigger_and_atomic_invoices.sql
--
-- Two corrections to 20260914114500.
--
-- 1. actual_close_date was filled in only by the deal form's stage
--    selector, but that is not how a deal usually closes: both the web
--    Kanban board and the mobile board move a deal by writing
--    stage_id/status straight to PostgREST, never through /api/deals.
--    A route-level default would still miss them. The transition rule
--    belongs to the table, so every surface records the date.
--
--    Only a TRANSITION fills the date, so an agent who deliberately
--    clears it on an already-closed deal is not overruled on the next
--    save. Reopening clears it: a deal that is open again has no close
--    date.
--
-- 2. Attaching an invoice was a read-modify-write over the whole JSONB
--    array. Two agents uploading at once both read the same snapshot
--    and the second write dropped the first file — success reported,
--    object orphaned. Append and remove now happen inside one statement.
-- ============================================================

CREATE OR REPLACE FUNCTION set_deal_actual_close_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('won', 'lost')
       AND NEW.actual_close_date IS NULL THEN
      NEW.actual_close_date := CURRENT_DATE;
    ELSIF NEW.status = 'open' THEN
      NEW.actual_close_date := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deals_set_actual_close_date ON deals;
CREATE TRIGGER deals_set_actual_close_date
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION set_deal_actual_close_date();

-- Append one invoice entry, returning the whole array as it now stands.
-- NULL means the deal is not this caller's to change.
CREATE OR REPLACE FUNCTION deal_invoice_append(
  p_deal_id UUID,
  p_entry JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_invoices JSONB;
BEGIN
  SELECT account_id INTO v_account_id FROM deals WHERE id = p_deal_id;
  IF v_account_id IS NULL OR NOT is_account_member(v_account_id, 'agent') THEN
    RETURN NULL;
  END IF;

  UPDATE deals
     SET invoices = COALESCE(invoices, '[]'::jsonb) || jsonb_build_array(p_entry)
   WHERE id = p_deal_id
  RETURNING invoices INTO v_invoices;

  RETURN v_invoices;
END;
$$;

-- Drop every entry whose `path` matches, returning the remaining array.
CREATE OR REPLACE FUNCTION deal_invoice_remove(
  p_deal_id UUID,
  p_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_invoices JSONB;
BEGIN
  SELECT account_id INTO v_account_id FROM deals WHERE id = p_deal_id;
  IF v_account_id IS NULL OR NOT is_account_member(v_account_id, 'agent') THEN
    RETURN NULL;
  END IF;

  UPDATE deals
     SET invoices = COALESCE(
           (
             SELECT jsonb_agg(entry)
               FROM jsonb_array_elements(COALESCE(invoices, '[]'::jsonb)) AS entry
              WHERE entry->>'path' IS DISTINCT FROM p_path
           ),
           '[]'::jsonb
         )
   WHERE id = p_deal_id
  RETURNING invoices INTO v_invoices;

  RETURN v_invoices;
END;
$$;

REVOKE ALL ON FUNCTION deal_invoice_append(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION deal_invoice_remove(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION deal_invoice_append(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION deal_invoice_remove(UUID, TEXT) TO authenticated;
