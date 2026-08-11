-- ============================================================
-- 249_language_usage_stats.sql
-- How many people actually use each language — on the app, and in
-- what we send them.
--
-- Two questions that look alike and are not:
--
--   App language:    how many AGENTS read ConvoReal in each language.
--                    Answered from profiles.active_ui_language.
--
--   Comms language:  how many CONTACTS we would message in each
--                    language. Answered from contacts.preferred_language,
--                    falling back to the account default — because a
--                    contact with no preference is not "unset" at send
--                    time, they receive the account's language, and a
--                    count that reported them as unknown would
--                    understate the language actually being sent.
--
-- Both aggregate in SQL rather than shipping rows to the browser
-- (AGENTS.md §2.6). An account with 50k contacts must not have to
-- download them to learn that 400 read Tamil.
--
-- Reach is deliberately reported next to the counts: knowing 400
-- contacts read Tamil matters much less than knowing how many of them
-- an approved Tamil template can actually reach.
-- ============================================================

-- Partial index for the app-language rollup. profiles is small, but
-- this keeps the group-by index-only as team sizes grow.
CREATE INDEX IF NOT EXISTS idx_profiles_account_ui_language
  ON profiles(account_id) INCLUDE (active_ui_language);

-- SECURITY DEFINER so the aggregate runs in one pass with the
-- membership check done once, not per row. A non-member gets no rows
-- rather than another account's numbers: the guard is in the WHERE
-- clause and is_account_member is STABLE, so Postgres evaluates it a
-- single time.
CREATE OR REPLACE FUNCTION public.language_usage_stats(p_account_id UUID)
RETURNS TABLE (
  language TEXT,
  -- Agents reading the app in this language.
  agents BIGINT,
  -- Contacts we would message in this language, preference first.
  contacts BIGINT,
  -- Of those contacts, how many stated it themselves rather than
  -- inheriting the account default. The gap is the size of the
  -- assumption being made.
  contacts_explicit BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH acct AS (
    SELECT COALESCE(default_language, 'en') AS default_language
      FROM accounts
     WHERE id = p_account_id
       AND is_account_member(p_account_id, 'agent')
  ),
  langs AS (
    SELECT unnest(ARRAY['en','hi','kn','ta','te','ml','mr']) AS code
  ),
  agent_counts AS (
    SELECT COALESCE(p.active_ui_language, 'en') AS code, count(*) AS n
      FROM profiles p, acct
     WHERE p.account_id = p_account_id
     GROUP BY 1
  ),
  contact_counts AS (
    SELECT
      COALESCE(c.preferred_language, a.default_language) AS code,
      count(*) AS n,
      count(*) FILTER (WHERE c.preferred_language IS NOT NULL) AS explicit_n
      FROM contacts c
      CROSS JOIN acct a
     WHERE c.account_id = p_account_id
       AND c.is_merged = false
       AND COALESCE(c.chain_only, false) = false
     GROUP BY 1
  )
  SELECT
    l.code,
    COALESCE(ac.n, 0),
    COALESCE(cc.n, 0),
    COALESCE(cc.explicit_n, 0)
    FROM langs l
    -- Inner-joined to acct so a non-member (empty acct) gets no rows
    -- at all rather than a table of zeros that looks like real data.
    CROSS JOIN acct
    LEFT JOIN agent_counts ac ON ac.code = l.code
    LEFT JOIN contact_counts cc ON cc.code = l.code
   ORDER BY COALESCE(cc.n, 0) DESC, l.code;
$$;

REVOKE ALL ON FUNCTION public.language_usage_stats(UUID) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.language_usage_stats(UUID) IS
  'Per-language agent and contact counts for one account. Contacts are counted by effective send language (preference, else account default); contacts_explicit is how many stated it themselves.';

-- ------------------------------------------------------------
-- Template reach.
--
-- The counts above say who we WANT to reach in each language. This
-- says who we CAN: a language with 400 contacts and no approved
-- template variant reaches none of them, and that gap is the whole
-- decision about what to translate next.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.template_language_coverage(p_account_id UUID)
RETURNS TABLE (
  language TEXT,
  approved_templates BIGINT,
  awaiting_review BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH member AS (
    SELECT 1 WHERE is_account_member(p_account_id, 'agent')
  ),
  -- Our short codes mapped to the codes Meta registers under; en
  -- covers all three of Meta's English spellings.
  langs(code, meta_codes) AS (
    VALUES
      ('en', ARRAY['en_US','en_GB','en']),
      ('hi', ARRAY['hi']),
      ('kn', ARRAY['kn']),
      ('ta', ARRAY['ta']),
      ('te', ARRAY['te']),
      ('ml', ARRAY['ml']),
      ('mr', ARRAY['mr'])
  )
  SELECT
    l.code,
    count(*) FILTER (WHERE upper(t.status) = 'APPROVED'),
    count(*) FILTER (
      WHERE upper(COALESCE(t.status, '')) <> 'APPROVED'
        AND t.translation_reviewed_at IS NULL
    )
    FROM langs l
    CROSS JOIN member
    LEFT JOIN message_templates t
      ON t.account_id = p_account_id
     AND t.language = ANY (l.meta_codes)
   GROUP BY l.code
   ORDER BY l.code;
$$;

REVOKE ALL ON FUNCTION public.template_language_coverage(UUID) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.template_language_coverage(UUID) IS
  'Approved and awaiting-review template counts per language for one account — what the language_usage_stats demand can actually be served in.';
