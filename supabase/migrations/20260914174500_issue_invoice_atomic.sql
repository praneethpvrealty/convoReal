-- ============================================================
-- 20260914174500_issue_invoice_atomic.sql — allocate the number and
-- spend it in the same transaction.
--
-- `allocate_invoice_number` locks the settings row, but that lock is
-- released the moment the function returns, and the number was written
-- to the invoice by a separate call over HTTP afterwards. Two agents
-- pressing Issue together could therefore both read the same
-- MAX(sequence_number) and be handed the same number; the unique index
-- caught the collision, but the loser saw a raw constraint error rather
-- than a second, valid number.
--
-- Doing both inside one function keeps the lock held across the read
-- and the write, so the second caller waits and then reads a MAX that
-- already includes the first invoice.
--
-- `allocate_invoice_number` stays: it is still the right call for a
-- caller that only wants to know the next number (a preview), and this
-- function reuses its policy by inlining the same rules.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION issue_invoice(
  p_invoice_id UUID,
  p_signed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_settings invoice_settings%ROWTYPE;
  v_financial_year TEXT;
  v_prefix TEXT;
  v_start INTEGER;
  v_resets BOOLEAN;
  v_next INTEGER;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_account_member(v_invoice.account_id, 'agent') THEN
    RAISE EXCEPTION 'Not authorised to issue invoices for this account';
  END IF;

  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'This invoice is already %', v_invoice.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- The Indian financial year runs April to March, so an invoice dated
  -- in January belongs to the year that began the previous April. Must
  -- agree with financialYearFor() in src/lib/invoices/financial-year.ts.
  v_financial_year :=
    CASE
      WHEN EXTRACT(MONTH FROM v_invoice.invoice_date) >= 4
        THEN EXTRACT(YEAR FROM v_invoice.invoice_date)::int
      ELSE EXTRACT(YEAR FROM v_invoice.invoice_date)::int - 1
    END::text
    || '-'
    || LPAD(
         ((CASE
             WHEN EXTRACT(MONTH FROM v_invoice.invoice_date) >= 4
               THEN EXTRACT(YEAR FROM v_invoice.invoice_date)::int + 1
             ELSE EXTRACT(YEAR FROM v_invoice.invoice_date)::int
           END) % 100)::text,
         2, '0'
       );

  -- Held for the rest of this transaction, which now includes the
  -- UPDATE below. That is the whole point of this function.
  SELECT * INTO v_settings
  FROM invoice_settings
  WHERE account_id = v_invoice.account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO invoice_settings (account_id)
    VALUES (v_invoice.account_id)
    ON CONFLICT (account_id) DO NOTHING;

    SELECT * INTO v_settings
    FROM invoice_settings
    WHERE account_id = v_invoice.account_id
    FOR UPDATE;
  END IF;

  v_prefix := COALESCE(v_settings.number_prefix, '');
  v_start := COALESCE(v_settings.starting_number, 1);
  v_resets := COALESCE(v_settings.number_resets_yearly, TRUE);

  IF v_resets THEN
    SELECT COALESCE(MAX(i.sequence_number) + 1, v_start)
    INTO v_next
    FROM invoices i
    WHERE i.account_id = v_invoice.account_id
      AND i.financial_year = v_financial_year;
  ELSE
    SELECT COALESCE(MAX(i.sequence_number) + 1, v_start)
    INTO v_next
    FROM invoices i
    WHERE i.account_id = v_invoice.account_id;
  END IF;

  UPDATE invoices
  SET status = 'issued',
      sequence_number = v_next,
      financial_year = v_financial_year,
      invoice_number = CASE
        WHEN v_prefix = '' THEN v_next || '/' || v_financial_year
        ELSE v_prefix || '/' || v_next || '/' || v_financial_year
      END,
      issued_at = NOW(),
      signed_at = p_signed_at
  WHERE id = p_invoice_id
    AND status = 'draft'
  RETURNING * INTO v_invoice;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invoice was issued by someone else'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION issue_invoice(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION issue_invoice(UUID, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION issue_invoice(UUID, TIMESTAMPTZ) IS
  'Allocates the next serial and marks the draft issued in one transaction, so concurrent issues queue rather than racing for the same number.';
