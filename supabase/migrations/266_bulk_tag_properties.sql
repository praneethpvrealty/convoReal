-- ============================================================
-- 266_bulk_tag_properties.sql
--
-- Add or remove internal search tags across many listings at once.
--
-- Tagging is a per-project act far more often than a per-listing one —
-- four villas in one development all want "APM" — and doing that a
-- listing at a time is four trips through the editor and four chances
-- to type it differently. A tag spelled two ways is worse than no tag:
-- the search still returns results, so nothing looks broken while half
-- the project is missing from it.
--
-- Set-based on purpose. Reading each listing's array, merging in the
-- client and writing it back is one round trip per listing, and two
-- agents tagging overlapping selections would each overwrite the
-- other's array wholesale. Here every row is merged against its own
-- current value inside one statement.
--
-- Case-insensitive throughout, keeping the spelling already on the row:
-- "apm" offered against a listing carrying "APM" is the same tag, and
-- silently ending up with both is the failure this exists to prevent.
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_tag_properties(
  target_account_id UUID,
  property_ids UUID[],
  add_tags TEXT[] DEFAULT '{}',
  remove_tags TEXT[] DEFAULT '{}'
)
RETURNS TABLE (id UUID, tags TEXT[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE properties p
  SET tags = COALESCE(
    (
      SELECT array_agg(d.tag ORDER BY d.ord)
      FROM (
        SELECT DISTINCT ON (lower(c.tag)) c.tag, c.ord
        FROM (
          -- Existing tags keep their position, so a merge never
          -- reshuffles a listing an agent has already curated.
          SELECT t AS tag, o AS ord
          FROM unnest(p.tags) WITH ORDINALITY AS e(t, o)
          UNION ALL
          -- Additions land after them, in the order they were given.
          SELECT t, 1000000 + o
          FROM unnest(add_tags) WITH ORDINALITY AS a(t, o)
        ) c
        WHERE btrim(c.tag) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM unnest(remove_tags) r
            WHERE lower(btrim(r)) = lower(btrim(c.tag))
          )
        ORDER BY lower(c.tag), c.ord
      ) d
    ),
    '{}'
  ),
  updated_at = NOW()
  WHERE p.account_id = target_account_id
    AND p.id = ANY(property_ids)
    AND is_account_member(target_account_id, 'agent'::account_role_enum)
  RETURNING p.id, p.tags;
$$;

COMMENT ON FUNCTION bulk_tag_properties(UUID, UUID[], TEXT[], TEXT[]) IS
  'Merge tags into / out of many properties in one statement, case-insensitively, keeping each row''s existing spelling and order. SECURITY DEFINER, guarded by is_account_member at agent role.';

-- Named explicitly: Supabase grants EXECUTE to anon as a ROLE rather
-- than through PUBLIC, so a PUBLIC-only revoke leaves a function
-- callable with the anon key that ships in the browser bundle
-- (migrations 263 and 264). This one writes, so it matters more.
REVOKE EXECUTE ON FUNCTION bulk_tag_properties(UUID, UUID[], TEXT[], TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bulk_tag_properties(UUID, UUID[], TEXT[], TEXT[]) TO authenticated, service_role;
