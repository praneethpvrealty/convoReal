-- ============================================================
-- 147_liaisons.sql — Liaisoning people directory.
--
-- One place for the government-office liaisons every deal leans on:
-- khata transfer / new khata / BBMP work, EC extraction, sub-registrar
-- registration, DC conversion, etc. Each person carries the list of
-- services they handle and the fee they quoted per service, so staff
-- stop re-asking "who do we call for EC and what does he charge?".
--
-- services JSONB shape:
--   [{ "name": "Khata transfer", "fee": 15000, "client_charge": 25000,
--      "fee_note": "per property, excl. govt charges" }]
-- fee = what the liaison charges us; client_charge = what we bill the
-- client. Margin (client_charge - fee) is computed in the UI, never
-- stored, so correcting either number can't leave a stale margin.
-- Kept as JSONB rather than a child table: the directory is dozens of
-- rows per account, always read whole-card, and never joined against.
-- ============================================================

CREATE TABLE IF NOT EXISTS liaisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  phone TEXT,
  alt_phone TEXT,
  email TEXT,
  -- Where they operate: "BBMP Bommanahalli", "SRO Jayanagar", ...
  office_area TEXT,

  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  -- Soft retire instead of delete — keeps the fee history visible
  -- when a liaison stops taking work.
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liaisons_account ON liaisons(account_id);

DROP TRIGGER IF EXISTS update_liaisons_updated_at ON liaisons;
CREATE TRIGGER update_liaisons_updated_at
  BEFORE UPDATE ON liaisons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE liaisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liaisons_select ON liaisons;
CREATE POLICY liaisons_select ON liaisons
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS liaisons_modify ON liaisons;
CREATE POLICY liaisons_modify ON liaisons
  FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
