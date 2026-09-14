-- ============================================================
-- 20260914120100_invoices.sql — brokerage commission invoices.
--
-- An invoice is not a view over a deal. The moment it is issued it is a
-- statutory record the customer holds a copy of, so everything it prints
-- is SNAPSHOT onto the row: `issuer`, `bill_to` and `line_items` are
-- frozen JSONB, not joins. Renaming a contact or correcting a property's
-- address next month must not silently rewrite an invoice already in
-- someone's inbox — which a join would do, invisibly.
--
-- One deal produces MORE than one invoice. The reference invoice bills
-- =ROUND(162000000*0.7%/2,0): half of the deal's 0.7% brokerage, because
-- the other half is billed to the other side. Hence `side` and
-- `share_percent` — the deal carries the whole brokerage, each invoice
-- carries its slice.
--
-- Line items are JSONB rather than a child table: they are only ever
-- read and written as a whole with their parent, and the snapshot is
-- immutable as a unit, so a second table would buy nothing.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Where the invoice came from. All nullable and SET NULL on delete:
  -- an issued invoice outlives the records it was built from.
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Joint buyers (a husband and wife on one purchase) are one party and
  -- get one invoice — see contact_parties, migration 288.
  party_id UUID REFERENCES contact_parties(id) ON DELETE SET NULL,

  -- Identity. NULL until issued: a draft has no number, because an
  -- allocated number can never be handed back.
  invoice_number TEXT,
  financial_year TEXT,
  sequence_number INTEGER,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'cancelled')),

  -- Which side of the deal is being billed, and how much of the deal's
  -- total brokerage this invoice claims.
  side TEXT NOT NULL DEFAULT 'buyer'
    CHECK (side IN ('buyer', 'seller', 'both')),
  share_percent NUMERIC(5,2) NOT NULL DEFAULT 100
    CHECK (share_percent > 0 AND share_percent <= 100),

  -- Frozen at issue. `issuer` is the letterhead + bank block copied from
  -- invoice_settings; `bill_to` is the customer block; `line_items` is
  -- [{ sl_no, sac, particulars[], taxable_value }].
  issuer JSONB NOT NULL DEFAULT '{}'::jsonb,
  bill_to JSONB NOT NULL DEFAULT '{}'::jsonb,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,

  place_of_supply TEXT,
  place_of_supply_code TEXT,
  gst_mode TEXT NOT NULL DEFAULT 'nil'
    CHECK (gst_mode IN ('nil', 'intra', 'inter')),
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,

  taxable_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_in_words TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',

  notes TEXT,

  -- SHA-256 of the rendered PDF at the moment of issue, hex. This is
  -- what makes the record tamper-evident: the PDF is regenerated on
  -- demand from the snapshot above, so a later render that hashes
  -- differently means the snapshot was touched. It is also exactly what
  -- a DSC or an Aadhaar eSign signs, so the hash frozen here is the
  -- bridge to either without re-rendering.
  document_hash TEXT,

  -- Frozen signature block: { mode, signatory_name, designation, place,
  -- image_path, provider, provider_ref, certificate_subject,
  -- certificate_serial }. Snapshot for the same reason as `issuer` —
  -- changing who signs today must not restate who signed in April.
  signature JSONB,
  signed_at TIMESTAMPTZ,

  issued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,

  -- Last rendered copy, kept only so a delivery channel has something to
  -- link. The PDF is regenerated from the snapshot on demand, so this is
  -- a cache and never the source of truth.
  pdf_path TEXT,

  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A number is unique within its series and is NEVER reused — a
-- cancelled invoice keeps its number precisely so the series stays
-- unbroken for an auditor. Partial, because drafts have no number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number_unique
  ON invoices (account_id, financial_year, sequence_number)
  WHERE sequence_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_account_created
  ON invoices (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_deal ON invoices (deal_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices (contact_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_select ON invoices;
CREATE POLICY invoices_select ON invoices FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS invoices_modify ON invoices;
CREATE POLICY invoices_modify ON invoices FOR ALL USING (
  is_account_member(account_id, 'agent')
) WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP TRIGGER IF EXISTS set_updated_at ON invoices;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Audit trail.
--
-- An electronic signature is only as good as the record of how it came
-- to be applied. Under the IT Act an image pasted on a PDF carries no
-- presumption on its own; what makes it evidence is being able to say
-- who pressed Issue, from where, when, and over exactly which bytes.
-- One append-only row per event does that, and it is also the trail an
-- auditor walks when a number in the series is questioned.
--
-- Append-only by policy: members may INSERT and SELECT, and there is no
-- UPDATE or DELETE policy at all, so a trail cannot be tidied up after
-- the fact by anyone going through RLS.
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  event TEXT NOT NULL
    CHECK (event IN ('created', 'issued', 'signed', 'sent', 'paid', 'cancelled', 'downloaded')),

  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_name TEXT,
  ip_address TEXT,
  user_agent TEXT,
  -- Hash of the document the event concerns, so "sent" can be tied to
  -- the exact bytes the customer received.
  document_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice
  ON invoice_events (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_events_account
  ON invoice_events (account_id);

ALTER TABLE invoice_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_events_select ON invoice_events;
CREATE POLICY invoice_events_select ON invoice_events FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS invoice_events_insert ON invoice_events;
CREATE POLICY invoice_events_insert ON invoice_events FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- ============================================================
-- Number allocation.
--
-- The next serial is derived from the invoices already issued, not from
-- a stored counter: a counter and a table can disagree, and when they do
-- the customer gets a duplicate number. MAX()+1 over the series cannot.
--
-- Serialised by locking the account's invoice_settings row, so two
-- agents pressing Issue at the same moment queue rather than collide.
-- The unique index above is the backstop if anyone ever writes a number
-- without coming through here.
-- ============================================================
CREATE OR REPLACE FUNCTION allocate_invoice_number(
  p_account_id UUID,
  p_financial_year TEXT
)
RETURNS TABLE (sequence_number INTEGER, invoice_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings invoice_settings%ROWTYPE;
  v_prefix TEXT;
  v_start INTEGER;
  v_resets BOOLEAN;
  v_next INTEGER;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Not authorised to issue invoices for this account';
  END IF;

  IF p_financial_year IS NULL OR p_financial_year !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid financial year: %', p_financial_year;
  END IF;

  -- Serialise concurrent issues for this account. The settings row is
  -- created on demand so a brokerage that never opened the settings
  -- screen can still issue on defaults.
  SELECT * INTO v_settings
  FROM invoice_settings
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO invoice_settings (account_id)
    VALUES (p_account_id)
    ON CONFLICT (account_id) DO NOTHING;

    SELECT * INTO v_settings
    FROM invoice_settings
    WHERE account_id = p_account_id
    FOR UPDATE;
  END IF;

  v_prefix := COALESCE(v_settings.number_prefix, '');
  v_start := COALESCE(v_settings.starting_number, 1);
  v_resets := COALESCE(v_settings.number_resets_yearly, TRUE);

  IF v_resets THEN
    SELECT COALESCE(MAX(i.sequence_number) + 1, v_start)
    INTO v_next
    FROM invoices i
    WHERE i.account_id = p_account_id
      AND i.financial_year = p_financial_year;
  ELSE
    SELECT COALESCE(MAX(i.sequence_number) + 1, v_start)
    INTO v_next
    FROM invoices i
    WHERE i.account_id = p_account_id;
  END IF;

  sequence_number := v_next;
  invoice_number := CASE
    WHEN v_prefix = '' THEN v_next || '/' || p_financial_year
    ELSE v_prefix || '/' || v_next || '/' || p_financial_year
  END;

  RETURN NEXT;
END;
$$;

-- `anon` has to be named explicitly. Supabase's default privileges grant
-- EXECUTE on a new public function directly to anon and authenticated,
-- and REVOKE ... FROM PUBLIC does not touch a grant made to a role by
-- name — so revoking only PUBLIC leaves anon still able to call it
-- (caught by the database linter after this first ran). The function
-- refuses an unauthenticated caller anyway, because is_account_member()
-- is false without an auth.uid(), but an RPC a signed-out visitor can
-- reach is one guard away from being a problem.
REVOKE ALL ON FUNCTION allocate_invoice_number(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION allocate_invoice_number(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION allocate_invoice_number(UUID, TEXT) IS
  'Allocates the next invoice serial for an account and financial year. Derives it from issued invoices rather than a counter, and locks invoice_settings so concurrent issues queue.';
