-- ============================================================
-- 20260914173000_invoice_immutability.sql — put the invoicing
-- invariants in the database, not only in the route handlers.
--
-- The invoices table shipped with one `FOR ALL` policy, which is the
-- whole story only if every write goes through `/api/invoices/*`. It
-- does not: both surfaces hold an anon key and a member JWT and talk to
-- PostgREST directly for most reads, so an agent could PATCH an issued
-- invoice's totals, revert its status, or DELETE it — taking its audit
-- events with it through the cascade — and the route's draft-only
-- checks would never run.
--
-- An invoice that can be edited after issue is not a record. So:
--
--   * DELETE is restricted to drafts. An issued invoice is cancelled,
--     which keeps its number and leaves the series unbroken.
--   * A BEFORE UPDATE trigger freezes everything the customer's copy
--     shows once the invoice leaves draft. Column-level rules cannot be
--     expressed in a policy, which is why this is a trigger and not
--     more RLS.
--   * The same trigger enforces the status graph, so `paid` cannot
--     quietly become `draft` again whatever issues the UPDATE.
--
-- Mirrors ALLOWED_TRANSITIONS and isEditable() in
-- src/lib/invoices/server.ts; the API keeps its checks so a caller gets
-- a clear 409 instead of a raw database error.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A draft is still being written; nothing is frozen yet.
  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'issued', 'cancelled') THEN
      RAISE EXCEPTION
        'A draft invoice can only be issued or cancelled, not marked %', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Past draft, the number is spent and the customer may hold a copy.
  IF NEW.status = 'draft' THEN
    RAISE EXCEPTION 'An issued invoice cannot return to draft'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled invoice cannot be reopened'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'A paid invoice can only be cancelled'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Everything the printed document asserts. Not frozen, and therefore
  -- absent here: status and its timestamps, cancel_reason, pdf_path,
  -- and the signature trio (signature, signed_at, document_hash), which
  -- a DSC or eSign provider fills in after issue.
  IF (
    NEW.account_id,     NEW.deal_id,          NEW.property_id,
    NEW.contact_id,     NEW.party_id,         NEW.invoice_number,
    NEW.financial_year, NEW.sequence_number,  NEW.invoice_date,
    NEW.side,           NEW.share_percent,    NEW.issuer,
    NEW.bill_to,        NEW.line_items,       NEW.place_of_supply,
    NEW.place_of_supply_code,                 NEW.gst_mode,
    NEW.gst_rate,       NEW.taxable_total,    NEW.cgst,
    NEW.sgst,           NEW.igst,             NEW.grand_total,
    NEW.amount_in_words, NEW.currency,        NEW.notes,
    NEW.created_by,     NEW.created_at,       NEW.issued_at
  ) IS DISTINCT FROM (
    OLD.account_id,     OLD.deal_id,          OLD.property_id,
    OLD.contact_id,     OLD.party_id,         OLD.invoice_number,
    OLD.financial_year, OLD.sequence_number,  OLD.invoice_date,
    OLD.side,           OLD.share_percent,    OLD.issuer,
    OLD.bill_to,        OLD.line_items,       OLD.place_of_supply,
    OLD.place_of_supply_code,                 OLD.gst_mode,
    OLD.gst_rate,       OLD.taxable_total,    OLD.cgst,
    OLD.sgst,           OLD.igst,             OLD.grand_total,
    OLD.amount_in_words, OLD.currency,        OLD.notes,
    OLD.created_by,     OLD.created_at,       OLD.issued_at
  ) THEN
    RAISE EXCEPTION
      'Invoice % is % and its contents can no longer change. Cancel it and raise a new one.',
      COALESCE(OLD.invoice_number, OLD.id::text), OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_invoice_immutability_trigger ON invoices;
CREATE TRIGGER enforce_invoice_immutability_trigger
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION enforce_invoice_immutability();

-- Replace the single FOR ALL policy with one per verb, so DELETE can be
-- held to drafts while UPDATE stays open for the status transitions the
-- trigger above polices.
DROP POLICY IF EXISTS invoices_modify ON invoices;

DROP POLICY IF EXISTS invoices_insert ON invoices;
CREATE POLICY invoices_insert ON invoices FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP POLICY IF EXISTS invoices_update ON invoices;
CREATE POLICY invoices_update ON invoices FOR UPDATE USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- A draft never had a number, so deleting one leaves no gap. Anything
-- else must be cancelled instead.
DROP POLICY IF EXISTS invoices_delete ON invoices;
CREATE POLICY invoices_delete ON invoices FOR DELETE USING (
  is_account_member(account_id, 'agent') AND status = 'draft'
);

COMMENT ON FUNCTION enforce_invoice_immutability() IS
  'Freezes an invoice''s printed contents once it leaves draft and enforces the status graph, so the invariants hold for direct PostgREST writes and not only through the API.';
