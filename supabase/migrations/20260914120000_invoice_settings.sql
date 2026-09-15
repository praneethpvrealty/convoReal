-- ============================================================
-- 20260914120000_invoice_settings.sql — the brokerage's own identity on an invoice.
--
-- Everything a brokerage invoice needs about the CUSTOMER is already in
-- the Engine (deal value, brokerage %, property, contact). Nothing about
-- the ISSUER is: the firm's legal name, its RERA registration, its PAN,
-- the bank account the money goes to, and the running invoice number
-- have never had a home, which is why invoices are still made by copying
-- last month's spreadsheet.
--
-- One row per account. Note what is NOT here: a "next number" counter.
-- The next number is derived from the invoices table itself (see the invoices migration),
-- so a failed insert, a restore, or a row deleted by hand can never
-- leave a counter pointing at a number that is already on a customer's
-- invoice. Settings carry only the policy: where the series starts, and
-- whether it restarts each financial year (GST rule 46(b) wants a serial
-- unique within a financial year, and most brokerages restart; the
-- reference invoice's series begins at 101, so the start is settable).
--
-- PAN and bank details are admin-and-above, unlike most account
-- settings: an agent issuing an invoice does not need to be able to
-- change where the money lands.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS invoice_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,

  -- Letterhead
  legal_name TEXT NOT NULL DEFAULT '',
  address_lines TEXT[] NOT NULL DEFAULT '{}',
  rera_number TEXT,
  pan TEXT,
  gstin TEXT,
  -- GST state code ('29' = Karnataka) and its name. The pair decides
  -- CGST+SGST vs IGST against the invoice's place of supply.
  state_code TEXT,
  state_name TEXT,

  -- Line-item defaults
  default_sac TEXT NOT NULL DEFAULT '997212',
  default_particulars TEXT NOT NULL DEFAULT 'Real Estate Brokerage Services',

  -- How much of a deal's brokerage one invoice bills. 50 because taking
  -- brokerage from both sides is the norm here — the reference invoice
  -- bills ROUND(162000000*0.7%/2,0), half of the deal's 0.7%, with the
  -- seller billed the rest. An account that charges one side only sets
  -- this to 100 once instead of correcting every invoice.
  default_share_percent NUMERIC(5,2) NOT NULL DEFAULT 50
    CHECK (default_share_percent > 0 AND default_share_percent <= 100),

  -- Tax posture. 'nil' is the default because a brokerage under the
  -- registration threshold charges no GST and prints why.
  gst_mode TEXT NOT NULL DEFAULT 'nil'
    CHECK (gst_mode IN ('nil', 'intra', 'inter')),
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  gst_note TEXT NOT NULL DEFAULT
    'Note: GST is NIL, as the aggregate annual turnover is below Rs.20 lakhs.',

  -- Payment instructions printed at the foot of the invoice
  bank_account_name TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_ifsc TEXT,

  signatory_label TEXT NOT NULL DEFAULT 'Authorised Signatory',
  terms TEXT,

  -- ----------------------------------------------------------
  -- Signature (IT Act, 2000). Three tiers, deliberately separated
  -- because they differ in law, not just in rendering:
  --
  --   'none'  — unsigned. GST rule 46 wants a signature; the proviso
  --             waives it only for an invoice issued electronically per
  --             the IT Act, which 'none' is not. Offered because an
  --             account may print and sign by hand.
  --   'image' — a scanned signature plus the audit trail in
  --             invoice_events. An electronic signature under s.3A/s.5:
  --             admissible, but with no s.85B presumption behind it.
  --   'dsc'   — a Class 3 certificate. A digital signature under s.3.
  --             A USB token cannot be reached from a server, so this
  --             means an HSM-held organisational document-signer cert.
  --   'esign' — Aadhaar eSign through a CCA-empanelled ESP.
  --
  -- Only the first two are implemented. 'dsc' and 'esign' need a
  -- commercial arrangement the product cannot make on an account's
  -- behalf, so the columns and the PDF seam exist and the providers
  -- plug in — see docs/invoice-digital-signature.md.
  -- ----------------------------------------------------------
  signature_mode TEXT NOT NULL DEFAULT 'image'
    CHECK (signature_mode IN ('none', 'image', 'dsc', 'esign')),
  signature_image_path TEXT,
  signatory_name TEXT,
  signatory_designation TEXT,
  signature_place TEXT,

  -- Numbering. '101' + '2026-27' prints as '101/2026-27'; a prefix
  -- ('PVC') prints as 'PVC/101/2026-27'.
  number_prefix TEXT NOT NULL DEFAULT '',
  starting_number INTEGER NOT NULL DEFAULT 1 CHECK (starting_number > 0),
  number_resets_yearly BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE invoice_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_settings_select ON invoice_settings;
CREATE POLICY invoice_settings_select ON invoice_settings FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS invoice_settings_modify ON invoice_settings;
CREATE POLICY invoice_settings_modify ON invoice_settings FOR ALL USING (
  is_account_member(account_id, 'admin')
) WITH CHECK (
  is_account_member(account_id, 'admin')
);

DROP TRIGGER IF EXISTS set_updated_at ON invoice_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON invoice_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN invoice_settings.starting_number IS
  'First serial of a series, used when no invoice exists yet for it. Settable so a brokerage can continue the series it already issues under.';

COMMENT ON COLUMN invoice_settings.number_resets_yearly IS
  'TRUE restarts the serial each Indian financial year (GST rule 46(b)); FALSE keeps one series running across years.';
