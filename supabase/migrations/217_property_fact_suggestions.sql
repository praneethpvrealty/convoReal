-- ============================================================
-- 217_property_fact_suggestions.sql
--
-- What an agent tells a buyer, proposed back onto the listing.
--
-- "Hey Anju, seller's final price is 10.5k per sqft" is a fact about
-- the property that today exists only as a chat bubble. The next buyer
-- asks the same question and the bot has nothing, so the agent retypes
-- it. This table is where that sentence becomes a field.
--
-- A suggestion, not a write. An agent quoting a rate to one buyer is
-- not always a standing truth — it can be a negotiating position, a
-- rate for a part of the plot, or a number that moves next week. A
-- mis-parse that silently repriced live inventory would be worse than
-- the retyping it saves, so extraction proposes and a human confirms.
-- Approval is what calls the write.
--
-- One pending suggestion per (property, field): a rate restated three
-- times across a thread is one decision, not three. The newest
-- extraction overwrites the pending row rather than queueing behind it,
-- because the latest thing the agent said is the one worth confirming.
-- Reviewed rows are never touched — they are the audit trail of what
-- was proposed, by which message, and what was decided.
-- ============================================================

CREATE TABLE IF NOT EXISTS property_fact_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- Who the agent was talking to when they said it. Kept when the
  -- contact is deleted so the evidence still reads.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  -- Whitelisted in src/lib/ai/chat-learning.ts; the CHECK keeps a
  -- future caller from proposing a column the reviewer never sees.
  field TEXT NOT NULL,
  -- The listing's value at extraction time, so the review card can show
  -- "4.41 Cr → 4.2 Cr" without re-reading a row that may since have moved.
  current_value NUMERIC,
  suggested_value NUMERIC NOT NULL,
  -- The agent's own sentence. The reviewer approves the sentence, not
  -- the model's reading of it.
  evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_fact_suggestions_field_check
    CHECK (field IN ('seller_final_price', 'seller_final_price_per_sqft')),
  CONSTRAINT property_fact_suggestions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- One open question per field per listing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_fact_suggestions_pending
  ON property_fact_suggestions (property_id, field)
  WHERE status = 'pending';

-- The review surface reads an account's open suggestions, newest first.
CREATE INDEX IF NOT EXISTS idx_property_fact_suggestions_account_pending
  ON property_fact_suggestions (account_id, created_at DESC)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS set_updated_at ON property_fact_suggestions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON property_fact_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE property_fact_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_fact_suggestions_select ON property_fact_suggestions;
CREATE POLICY property_fact_suggestions_select ON property_fact_suggestions FOR SELECT USING (
  is_account_member(account_id)
);

-- Extraction writes through the service role, but an agent correcting a
-- listing by hand goes through the same table.
DROP POLICY IF EXISTS property_fact_suggestions_insert ON property_fact_suggestions;
CREATE POLICY property_fact_suggestions_insert ON property_fact_suggestions FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

-- Approving or rejecting is an update; the row is never deleted, so the
-- decision stays auditable against the message that prompted it.
DROP POLICY IF EXISTS property_fact_suggestions_update ON property_fact_suggestions;
CREATE POLICY property_fact_suggestions_update ON property_fact_suggestions FOR UPDATE USING (
  is_account_member(account_id, 'agent')
);
