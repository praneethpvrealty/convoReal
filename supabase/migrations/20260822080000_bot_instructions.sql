CREATE TABLE IF NOT EXISTS bot_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  directive TEXT NOT NULL CHECK (char_length(directive) BETWEEN 1 AND 1000),
  influence TEXT NOT NULL CHECK (
    influence IN ('tone', 'question_order', 'volunteering', 'collateral', 'handover')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('proposed', 'active', 'paused')
  ),
  source TEXT NOT NULL DEFAULT 'typed' CHECK (
    source IN ('typed', 'learned_from_correction')
  ),
  contact_classification TEXT,
  listing_type TEXT,
  funnel_stage TEXT,
  language TEXT,
  hit_count BIGINT NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  last_hit_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_instructions_retrieval
  ON bot_instructions (account_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON bot_instructions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bot_instructions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bot_instructions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_instructions_select ON bot_instructions;
CREATE POLICY bot_instructions_select ON bot_instructions FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS bot_instructions_insert ON bot_instructions;
CREATE POLICY bot_instructions_insert ON bot_instructions FOR INSERT WITH CHECK (
  is_account_member(account_id, 'admin')
);

DROP POLICY IF EXISTS bot_instructions_update ON bot_instructions;
CREATE POLICY bot_instructions_update ON bot_instructions FOR UPDATE USING (
  is_account_member(account_id, 'admin')
);

CREATE OR REPLACE FUNCTION match_bot_instructions(
  p_account_id UUID,
  p_contact_classification TEXT DEFAULT NULL,
  p_listing_type TEXT DEFAULT NULL,
  p_funnel_stage TEXT DEFAULT NULL,
  p_language TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, directive TEXT, influence TEXT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.directive, b.influence
  FROM bot_instructions b
  WHERE b.account_id = p_account_id
    AND b.status = 'active'
    AND (b.contact_classification IS NULL OR b.contact_classification = p_contact_classification)
    AND (b.listing_type IS NULL OR b.listing_type = p_listing_type)
    AND (b.funnel_stage IS NULL OR b.funnel_stage = p_funnel_stage)
    AND (b.language IS NULL OR b.language = p_language)
    AND (auth.role() = 'service_role' OR is_account_member(p_account_id))
  ORDER BY
    num_nonnulls(b.contact_classification, b.listing_type, b.funnel_stage, b.language) DESC,
    b.updated_at DESC,
    b.id
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION match_bot_instructions(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_bot_instructions(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION mark_bot_instructions_fired(
  p_account_id UUID,
  p_instruction_ids UUID[]
)
RETURNS VOID
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE bot_instructions
  SET hit_count = hit_count + 1,
      last_hit_at = NOW()
  WHERE account_id = p_account_id
    AND id = ANY(p_instruction_ids)
    AND status = 'active'
    AND cardinality(p_instruction_ids) <= 20
    AND auth.role() = 'service_role';
$$;

REVOKE ALL ON FUNCTION mark_bot_instructions_fired(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_bot_instructions_fired(UUID, UUID[]) TO service_role;

COMMENT ON TABLE bot_instructions IS
  'Account-scoped, human-controlled rules that may shape bot replies but never initiate sends.';
