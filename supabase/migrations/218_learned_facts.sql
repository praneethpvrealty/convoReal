-- ============================================================
-- 218_learned_facts.sql
--
-- One ledger for everything the Engine learns from a conversation.
--
-- Four learners grew up separately and diverged where it mattered:
--
--   buyer preferences   inbound message  → contacts.pref_*   no audit
--   property facts      agent's reply    → suggestion queue   audited
--   owner edits         quote-reply      → direct patch       no audit
--   portal drift        portal sync      → nothing stored     n/a
--
-- The gap in row one is the dangerous one. Gemini rewrites a contact's
-- budget, areas and projects on EVERY inbound message, silently and
-- with no record. A single mis-parse of "not more than 2cr" changes
-- who that buyer matches, and there is nothing to look at afterwards
-- and nothing to roll back to. The property side already solved this;
-- the side that runs a hundred times more often did not get it.
--
-- So: every learned fact lands here, whether it was applied on the spot
-- or is waiting for a human. `disposition` is what separates them, and
-- it belongs to the FIELD, not the caller — see src/lib/learning/
-- fields.ts. A price a seller will accept is always reviewed; a buyer's
-- stated budget is always applied, because the qualification ladder
-- reads it back on the next message and a queue would stall the
-- conversation. Both leave a row.
--
-- Values are JSONB because the fields genuinely differ: a numeric
-- seller_final_price and an array of pref_areas have to share a
-- column, and stringifying the array would make "did this change?"
-- depend on element order.
--
-- entity_id is polymorphic and deliberately carries no foreign key —
-- there is no one table to point at. Readers join to the entity and
-- drop what no longer resolves, so a deleted listing takes its history
-- out of the review queue without taking down the write path.
-- ============================================================

CREATE TABLE IF NOT EXISTS learned_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('property', 'contact')),
  entity_id UUID NOT NULL,
  field TEXT NOT NULL,
  -- What the record said before. Snapshotted so a review card can show
  -- the change without re-reading a row that may since have moved, and
  -- so an applied fact can be reasoned about after the fact.
  previous_value JSONB,
  value JSONB NOT NULL,
  -- The sentence this was read out of. A reviewer approves the
  -- sentence, not the model's reading of it.
  evidence TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('agent_reply', 'lead_message', 'owner_reply', 'portal_sync')),
  disposition TEXT NOT NULL CHECK (disposition IN ('auto', 'propose')),
  -- 'applied' is the audit row for an auto field: already written, kept
  -- so it can be seen and undone. 'pending' is waiting on a human.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open question per field per record. A rate restated three times
-- across a thread is one decision, not three.
CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_facts_pending
  ON learned_facts (entity_type, entity_id, field)
  WHERE status = 'pending';

-- The review surface reads an account's open items, newest first.
CREATE INDEX IF NOT EXISTS idx_learned_facts_account_pending
  ON learned_facts (account_id, created_at DESC)
  WHERE status = 'pending';

-- "What has the bot changed on this record?" — the audit read.
CREATE INDEX IF NOT EXISTS idx_learned_facts_entity
  ON learned_facts (entity_type, entity_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON learned_facts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON learned_facts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE learned_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learned_facts_select ON learned_facts;
CREATE POLICY learned_facts_select ON learned_facts FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS learned_facts_insert ON learned_facts;
CREATE POLICY learned_facts_insert ON learned_facts FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Approving, rejecting and undoing are updates; rows are never deleted,
-- so the decision stays auditable against the message that prompted it.
DROP POLICY IF EXISTS learned_facts_update ON learned_facts;
CREATE POLICY learned_facts_update ON learned_facts FOR UPDATE USING (
  is_account_member(account_id, 'agent')
);

-- ── Fold in the property-only predecessor ────────────────────
-- Migration 216 shipped property_fact_suggestions on this branch. Carry
-- anything it collected across rather than stranding it, then drop it:
-- two queues asking the same question is exactly what this migration
-- exists to stop.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'property_fact_suggestions'
  ) THEN
    INSERT INTO learned_facts (
      id, account_id, entity_type, entity_id, field,
      previous_value, value, evidence, source, disposition, status,
      contact_id, conversation_id, message_id,
      reviewed_by, reviewed_at, created_at, updated_at
    )
    SELECT
      s.id, s.account_id, 'property', s.property_id, s.field,
      to_jsonb(s.current_value), to_jsonb(s.suggested_value),
      s.evidence, 'agent_reply', 'propose', s.status,
      s.contact_id, s.conversation_id, s.message_id,
      s.reviewed_by, s.reviewed_at, s.created_at, s.updated_at
    FROM property_fact_suggestions s
    ON CONFLICT (id) DO NOTHING;

    DROP TABLE property_fact_suggestions;
  END IF;
END $$;
