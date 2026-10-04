-- ============================================================
-- 20261004125900_copilot_find_contacts.sql
--
-- The Helper answers "which contacts are looking for residential in
-- JP Nagar under 2 Cr?" from the contact rows themselves. The engine
-- parses the question into locality stems, type probes, a BHK band, a
-- budget band and deal types; this function does the matching in SQL
-- so an account with thousands of contacts never ships them to Node
-- (§2.6 of AGENTS.md). It runs as SECURITY INVOKER on purpose: the
-- contacts_select policy (migration 162) is narrower than account
-- membership — an org_agent sees only contacts assigned to them or
-- their team — and the Helper must never list a contact the caller's
-- own Contacts page would hide. The is_account_member() guard stays
-- as the cheap early exit; RLS does the per-row scoping.
--
-- A contact's requirement lives in three places and all three count:
-- the flat columns an agent typed (areas_of_interest, min/max_budget,
-- property_interests), the AI-extracted pref_* columns, and each
-- active entry of requirement_profiles. Free-text `requirements` is a
-- weaker signal that still qualifies a row, so a contact whose brief
-- was never extracted is found rather than invisible.
--
-- Area probes arrive as a JSONB array of stem arrays — [["jp"]] for
-- "JP Nagar", [["electronic"]] for "Electronics City" — and every stem
-- of one locality must start a word in the same stored area string:
-- "jaya" finds "Jayanagar" and "electronic" finds "Electronics City",
-- the fused-suffix tolerance src/lib/locality-match.ts applies to
-- inventory, while "jp" no longer finds "Chamarajpet". Type probes are
-- whole words on both boundaries, so "house" does not qualify a
-- warehouse buyer as residential.
--
-- A budget band is read as the buyer's ceiling: "under 2 Cr" keeps a
-- contact whose stated maximum fits under 2 Cr (10% slack) or who has
-- no budget on record, and "above 1.5 Cr" keeps one whose maximum
-- reaches it. Contacts without a budget or BHK on record still match
-- but score below those whose record confirms the fit.
--
-- Exclusions mirror src/lib/matching.ts: merged, chain-only, archived
-- and dead contacts, and a parked requirement (requirement_active =
-- false), never match.
-- ============================================================

CREATE OR REPLACE FUNCTION public.copilot_profile_values(
  p_profiles JSONB,
  p_key TEXT
)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(ARRAY_AGG(vals.v), '{}'::TEXT[])
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_profiles) = 'array' THEN p_profiles ELSE '[]'::jsonb END
  ) AS p
  CROSS JOIN LATERAL (
    SELECT x AS v
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p -> p_key) = 'array' THEN p -> p_key ELSE '[]'::jsonb END
    ) AS x
    UNION ALL
    SELECT p ->> p_key
    WHERE jsonb_typeof(p -> p_key) IN ('string', 'number')
  ) AS vals
  WHERE (jsonb_typeof(p -> 'active') <> 'boolean' OR (p ->> 'active')::BOOLEAN)
    AND NULLIF(BTRIM(vals.v), '') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.copilot_regex_literal(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(LOWER(COALESCE(p_text, '')), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
$$;

CREATE OR REPLACE FUNCTION public.copilot_find_contacts(
  p_account_id UUID,
  p_area_probes JSONB DEFAULT '[]'::jsonb,
  p_type_probes TEXT[] DEFAULT '{}'::TEXT[],
  p_bhk_min INT DEFAULT NULL,
  p_bhk_max INT DEFAULT NULL,
  p_budget_min NUMERIC DEFAULT NULL,
  p_budget_max NUMERIC DEFAULT NULL,
  p_listing_types TEXT[] DEFAULT '{}'::TEXT[],
  p_limit INT DEFAULT 4
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  second_name TEXT,
  company TEXT,
  classification TEXT,
  min_budget NUMERIC,
  max_budget NUMERIC,
  matched_area TEXT,
  score INT,
  total BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH probes AS (
    SELECT
      CASE WHEN jsonb_typeof(p_area_probes) = 'array' THEN p_area_probes ELSE '[]'::jsonb END AS areas,
      COALESCE(p_type_probes, '{}'::TEXT[]) AS types,
      COALESCE(p_listing_types, '{}'::TEXT[]) AS listings
  ),
  base AS (
    SELECT
      c.id,
      c.name::TEXT AS name,
      c.second_name::TEXT AS second_name,
      c.company::TEXT AS company,
      c.classification::TEXT AS classification,
      LOWER(COALESCE(c.requirements, '')) AS requirements,
      COALESCE(c.last_contacted_at, c.updated_at) AS recency,
      ARRAY(
        SELECT DISTINCT BTRIM(a)
        FROM UNNEST(
          COALESCE(c.areas_of_interest, '{}'::TEXT[])
          || COALESCE(c.pref_areas, '{}'::TEXT[])
          || public.copilot_profile_values(c.requirement_profiles, 'areas')
          || public.copilot_profile_values(c.requirement_profiles, 'projects')
        ) AS a
        WHERE NULLIF(BTRIM(a), '') IS NOT NULL
      ) AS areas,
      ARRAY(
        SELECT DISTINCT LOWER(BTRIM(t))
        FROM UNNEST(
          COALESCE(c.pref_property_categories, '{}'::TEXT[])
          || COALESCE(c.pref_property_types, '{}'::TEXT[])
          || COALESCE(c.property_interests, '{}'::TEXT[])
          || public.copilot_profile_values(c.requirement_profiles, 'property_categories')
          || public.copilot_profile_values(c.requirement_profiles, 'property_types')
        ) AS t
        WHERE NULLIF(BTRIM(t), '') IS NOT NULL
      ) AS types,
      ARRAY(
        SELECT DISTINCT LOWER(BTRIM(l))
        FROM UNNEST(
          COALESCE(c.pref_listing_types, '{}'::TEXT[])
          || public.copilot_profile_values(c.requirement_profiles, 'listing_types')
        ) AS l
        WHERE NULLIF(BTRIM(l), '') IS NOT NULL
      ) AS listings,
      LEAST(
        c.min_budget,
        c.pref_budget_min,
        (SELECT MIN(v::NUMERIC)
           FROM UNNEST(public.copilot_profile_values(c.requirement_profiles, 'budget_min')) v
          WHERE v ~ '^[0-9]+(\.[0-9]+)?$')
      )::NUMERIC AS budget_lo,
      GREATEST(
        c.max_budget,
        c.pref_budget_max,
        (SELECT MAX(v::NUMERIC)
           FROM UNNEST(public.copilot_profile_values(c.requirement_profiles, 'budget_max')) v
          WHERE v ~ '^[0-9]+(\.[0-9]+)?$')
      )::NUMERIC AS budget_hi,
      LEAST(
        c.pref_bhk_min,
        (SELECT MIN(v::NUMERIC)
           FROM UNNEST(public.copilot_profile_values(c.requirement_profiles, 'bhk_min')) v
          WHERE v ~ '^[0-9]+(\.[0-9]+)?$')
      )::NUMERIC AS bhk_lo,
      GREATEST(
        c.pref_bhk_max,
        (SELECT MAX(v::NUMERIC)
           FROM UNNEST(public.copilot_profile_values(c.requirement_profiles, 'bhk_max')) v
          WHERE v ~ '^[0-9]+(\.[0-9]+)?$')
      )::NUMERIC AS bhk_hi
    FROM contacts c
    WHERE c.account_id = p_account_id
      AND public.is_account_member(p_account_id)
      AND COALESCE(c.is_merged, FALSE) = FALSE
      AND c.merged_into_id IS NULL
      AND COALESCE(c.chain_only, FALSE) = FALSE
      AND COALESCE(c.is_archived, FALSE) = FALSE
      AND COALESCE(c.is_dead, FALSE) = FALSE
      AND COALESCE(c.requirement_active, TRUE) = TRUE
  ),
  judged AS (
    SELECT
      b.*,
      (
        SELECT a
        FROM UNNEST(b.areas) AS a
        WHERE EXISTS (
          SELECT 1
          FROM jsonb_array_elements((SELECT areas FROM probes)) AS ps
          WHERE jsonb_typeof(ps) = 'array'
            AND jsonb_array_length(ps) > 0
            AND (
              SELECT BOOL_AND(LOWER(a) ~ ('\m' || public.copilot_regex_literal(s)))
              FROM jsonb_array_elements_text(ps) AS s
            )
        )
        ORDER BY LENGTH(a)
        LIMIT 1
      ) AS matched_area,
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements((SELECT areas FROM probes)) AS ps
        WHERE jsonb_typeof(ps) = 'array'
          AND jsonb_array_length(ps) > 0
          AND (
            SELECT BOOL_AND(b.requirements ~ ('\m' || public.copilot_regex_literal(s)))
            FROM jsonb_array_elements_text(ps) AS s
          )
      ) AS area_in_text,
      EXISTS (
        SELECT 1
        FROM UNNEST(b.types) AS t, UNNEST((SELECT types FROM probes)) AS pr
        WHERE t ~ ('\m' || public.copilot_regex_literal(pr) || '\M')
      ) AS type_match,
      EXISTS (
        SELECT 1
        FROM UNNEST((SELECT types FROM probes)) AS pr
        WHERE b.requirements ~ ('\m' || public.copilot_regex_literal(pr) || '\M')
      ) AS type_in_text
    FROM base b
  ),
  filtered AS (
    SELECT
      j.*,
      (j.budget_lo IS NOT NULL OR j.budget_hi IS NOT NULL) AS has_budget,
      (j.bhk_lo IS NOT NULL OR j.bhk_hi IS NOT NULL) AS has_bhk
    FROM judged j, probes p
    WHERE (jsonb_array_length(p.areas) = 0 OR j.matched_area IS NOT NULL OR j.area_in_text)
      AND (CARDINALITY(p.types) = 0 OR j.type_match OR j.type_in_text)
      AND (p_budget_min IS NULL OR j.budget_hi IS NULL OR j.budget_hi * 1.1 >= p_budget_min)
      AND (p_budget_max IS NULL OR j.budget_hi IS NULL OR j.budget_hi * 0.9 <= p_budget_max)
      AND (p_budget_max IS NULL OR j.budget_lo IS NULL OR j.budget_lo * 0.9 <= p_budget_max)
      AND (p_bhk_min IS NULL OR j.bhk_hi IS NULL OR j.bhk_hi >= p_bhk_min)
      AND (p_bhk_max IS NULL OR j.bhk_lo IS NULL OR j.bhk_lo <= p_bhk_max)
      AND (
        CARDINALITY(p.listings) = 0
        OR CARDINALITY(j.listings) = 0
        OR EXISTS (
          SELECT 1 FROM UNNEST(j.listings) AS l, UNNEST(p.listings) AS pl
          WHERE l = LOWER(pl)
        )
      )
  ),
  scored AS (
    SELECT
      f.id,
      f.name,
      f.second_name,
      f.company,
      f.classification,
      f.budget_lo AS min_budget,
      f.budget_hi AS max_budget,
      f.matched_area,
      (
        CASE WHEN f.matched_area IS NOT NULL THEN 4 WHEN f.area_in_text THEN 2 ELSE 0 END
        + CASE WHEN f.type_match THEN 3 WHEN f.type_in_text THEN 1 ELSE 0 END
        + CASE WHEN (p_budget_min IS NOT NULL OR p_budget_max IS NOT NULL) AND f.has_budget THEN 2 ELSE 0 END
        + CASE WHEN (p_bhk_min IS NOT NULL OR p_bhk_max IS NOT NULL) AND f.has_bhk THEN 1 ELSE 0 END
        + CASE WHEN f.classification IN ('Buyer', 'Owner & Buyer') THEN 1 ELSE 0 END
      )::INT AS score,
      COUNT(*) OVER ()::BIGINT AS total,
      f.recency
    FROM filtered f
  )
  SELECT
    s.id,
    s.name,
    s.second_name,
    s.company,
    s.classification,
    s.min_budget,
    s.max_budget,
    s.matched_area,
    s.score,
    s.total
  FROM scored s
  ORDER BY s.score DESC, s.recency DESC NULLS LAST, s.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 10);
$$;

REVOKE ALL ON FUNCTION public.copilot_profile_values(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_profile_values(JSONB, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.copilot_regex_literal(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_regex_literal(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.copilot_find_contacts(UUID, JSONB, TEXT[], INT, INT, NUMERIC, NUMERIC, TEXT[], INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_find_contacts(UUID, JSONB, TEXT[], INT, INT, NUMERIC, NUMERIC, TEXT[], INT) TO authenticated;
