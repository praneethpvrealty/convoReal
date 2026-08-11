-- ============================================================
-- 250_language_coverage_awaiting_fix.sql
--
-- template_language_coverage reported "1 awaiting review" for every
-- language holding no templates at all.
--
-- The LEFT JOIN emits one all-NULL row for a language with no match,
-- and that phantom row satisfies the awaiting_review filter:
-- upper(COALESCE(NULL,'')) <> 'APPROVED' is true, and
-- translation_reviewed_at IS NULL is true. So the count was 1 wherever
-- it should have been 0 — which is every language a brokerage has not
-- started translating yet, the exact state the card exists to show.
--
-- The approved_templates filter was never affected: upper(NULL) is
-- NULL, so the phantom row simply fails that test.
--
-- Visible as "0 +1 to review" on the language-usage card in Settings,
-- reading as work in progress where no work had been started.
-- ============================================================

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
      -- t.id IS NOT NULL excludes the LEFT JOIN's phantom row; without
      -- it a language with no templates counts itself as one awaiting
      -- review.
      WHERE t.id IS NOT NULL
        AND upper(COALESCE(t.status, '')) <> 'APPROVED'
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
