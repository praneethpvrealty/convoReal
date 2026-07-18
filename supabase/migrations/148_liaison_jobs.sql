-- ============================================================
-- 148_liaison_jobs.sql — Liaison jobs & payments ledger.
--
-- Phase 2 of the liaisoning directory (147). A job is one actual
-- engagement — "khata transfer for property X for client Y" — with
-- money tracked both ways:
--   client_charge / liaison_fee: the amounts agreed for THIS job
--     (seeded from the directory rate card, editable per job);
--   liaison_job_payments: actual cash movement — 'in' rows are
--     received from the client, 'out' rows are paid to the liaison.
-- Balances (charge - received, fee - paid) and margin (agreed:
-- charge - fee; realized: received - paid) are computed in the UI,
-- never stored, so a corrected entry can't leave stale totals.
-- ============================================================

CREATE TABLE IF NOT EXISTS liaison_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  liaison_id UUID NOT NULL REFERENCES liaisons(id) ON DELETE CASCADE,

  -- Snapshot of the service name — rate-card entries get renamed or
  -- removed, but a job must keep saying what it was for.
  service_name TEXT NOT NULL,

  -- Optional CRM links: whose paperwork, and for which listing.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,

  client_charge NUMERIC CHECK (client_charge IS NULL OR client_charge >= 0),
  liaison_fee NUMERIC CHECK (liaison_fee IS NULL OR liaison_fee >= 0),

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'cancelled')),
  notes TEXT,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liaison_jobs_account
  ON liaison_jobs(account_id, status);
CREATE INDEX IF NOT EXISTS idx_liaison_jobs_liaison
  ON liaison_jobs(liaison_id);

DROP TRIGGER IF EXISTS update_liaison_jobs_updated_at ON liaison_jobs;
CREATE TRIGGER update_liaison_jobs_updated_at
  BEFORE UPDATE ON liaison_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE liaison_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liaison_jobs_select ON liaison_jobs;
CREATE POLICY liaison_jobs_select ON liaison_jobs
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS liaison_jobs_modify ON liaison_jobs;
CREATE POLICY liaison_jobs_modify ON liaison_jobs
  FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS liaison_job_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES liaison_jobs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- 'in' = received from the client, 'out' = paid to the liaison.
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liaison_job_payments_job
  ON liaison_job_payments(job_id);
CREATE INDEX IF NOT EXISTS idx_liaison_job_payments_account
  ON liaison_job_payments(account_id);

ALTER TABLE liaison_job_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liaison_job_payments_select ON liaison_job_payments;
CREATE POLICY liaison_job_payments_select ON liaison_job_payments
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS liaison_job_payments_modify ON liaison_job_payments;
CREATE POLICY liaison_job_payments_modify ON liaison_job_payments
  FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
