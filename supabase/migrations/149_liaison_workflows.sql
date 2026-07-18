-- ============================================================
-- 149_liaison_workflows.sql — Liaison process workflows.
--
-- Phase 3 of the liaisoning module (147, 148). A workflow explains a
-- government process to a client, stage by stage — e.g. "Change name
-- in the khata document": case worker logs the case → ARO approves →
-- JD reviews and transfers to DC → DC approves → completed. Each
-- stage carries the approval authority and an indicative timeline;
-- the whole thing renders into a WhatsApp message the client can
-- actually follow.
--
-- stages JSONB shape:
--   [{ "name": "Case login", "authority": "Case worker",
--      "duration_days": 2, "description": "Case is logged with your
--      documents in the BBMP system." }]
-- JSONB, not a child table: stages are only ever read as one ordered
-- list, and array order IS the process order.
-- ============================================================

CREATE TABLE IF NOT EXISTS liaison_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- What process this explains: "Change name in the khata document".
  service_name TEXT NOT NULL,
  description TEXT,

  stages JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liaison_workflows_account
  ON liaison_workflows(account_id);

DROP TRIGGER IF EXISTS update_liaison_workflows_updated_at ON liaison_workflows;
CREATE TRIGGER update_liaison_workflows_updated_at
  BEFORE UPDATE ON liaison_workflows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE liaison_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liaison_workflows_select ON liaison_workflows;
CREATE POLICY liaison_workflows_select ON liaison_workflows
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS liaison_workflows_modify ON liaison_workflows;
CREATE POLICY liaison_workflows_modify ON liaison_workflows
  FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
