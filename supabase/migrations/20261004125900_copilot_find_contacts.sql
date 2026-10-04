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
-- A contact is matched brief by brief, the contract src/lib/matching.ts
-- follows: the flat columns (areas_of_interest, min/max_budget,
-- property_interests and the AI-extracted pref_* twins) are one brief,
-- and every active requirement_profiles entry is another. A buyer with
-- a Villa/Whitefield/5 Cr profile and a Plot/Sarjapur/1 Cr profile is
-- found for "villa in Whitefield under 5 Cr" and for "plot in Sarjapur
-- under 1 Cr", never for "villa in Sarjapur under 5 Cr", because no
-- single brief says that. Free-text requirements (or a profile's
-- raw_text) is a weaker signal inside its own brief, so a contact whose
-- brief was never extracted is found rather than invisible.
--
-- Area probes arrive as a JSONB array of stem arrays — [["jp"]] for
-- "JP Nagar", [["electronic"]] for "Electronics City" — and every stem
-- of one locality must start a word in the same stored area string:
-- "jaya" finds "Jayanagar" and "electronic" finds "Electronics City",
-- the fused-suffix tolerance src/lib/locality-match.ts applies to
-- inventory, while "jp" no longer finds "Chamarajpet". Type probes are
-- whole words on both boundaries, so "house" does not qualify a
-- warehouse buyer as residential. Every probe is regex-escaped here as
-- well as in TypeScript.
--
-- A budget band is read as the buyer's ceiling: "under 2 Cr" keeps a
-- brief whose stated maximum fits under 2 Cr (10% slack) or that has
-- no budget on record, and "above 1.5 Cr" keeps one whose maximum
-- reaches it. Briefs without a budget or BHK on record still match
-- but score below those whose record confirms the fit.
--
-- Exclusions mirror src/lib/matching.ts: merged, chain-only, archived
-- and dead contacts, and a parked requirement (requirement_active =
-- false), never match.
-- ============================================================

-- An earlier cut of this migration, applied to the project while the
-- change was under review, created copilot_profile_values; nothing
-- references it any more.
DROP FUNCTION IF EXISTS public.copilot_profile_values(JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.copilot_json_text_array(p_value JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT BTRIM(x)
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END
      ) AS x
      WHERE NULLIF(BTRIM(x), '') IS NOT NULL
    ),
    '{}'::TEXT[]
  );
$$;

CREATE OR REPLACE FUNCTION public.copilot_json_number(p_value JSONB)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_value) = 'number' THEN (p_value #>> '{}')::NUMERIC
    WHEN jsonb_typeof(p_value) = 'string' AND (p_value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (p_value #>> '{}')::NUMERIC
  END;
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
  visible AS (
    SELECT
      c.id,
      c.name::TEXT AS name,
      c.second_name::TEXT AS second_name,
      c.company::TEXT AS company,
      c.classification::TEXT AS classification,
      LOWER(COALESCE(c.requirements, '')) AS requirements,
      COALESCE(c.last_contacted_at, c.updated_at) AS recency,
      c.areas_of_interest,
      c.pref_areas,
      c.pref_property_categories,
      c.pref_property_types,
      c.property_interests,
      c.pref_listing_types,
      c.min_budget,
      c.pref_budget_min,
      c.max_budget,
      c.pref_budget_max,
      c.pref_bhk_min,
      c.pref_bhk_max,
      CASE WHEN jsonb_typeof(c.requirement_profiles) = 'array' THEN c.requirement_profiles ELSE '[]'::jsonb END AS profiles
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
  briefs AS (
    SELECT
      v.id AS contact_id,
      v.requirements,
      ARRAY(
        SELECT DISTINCT BTRIM(a)
        FROM UNNEST(COALESCE(v.areas_of_interest, '{}'::TEXT[]) || COALESCE(v.pref_areas, '{}'::TEXT[])) AS a
        WHERE NULLIF(BTRIM(a), '') IS NOT NULL
      ) AS areas,
      ARRAY(
        SELECT DISTINCT LOWER(BTRIM(t))
        FROM UNNEST(
          COALESCE(v.pref_property_categories, '{}'::TEXT[])
          || COALESCE(v.pref_property_types, '{}'::TEXT[])
          || COALESCE(v.property_interests, '{}'::TEXT[])
        ) AS t
        WHERE NULLIF(BTRIM(t), '') IS NOT NULL
      ) AS types,
      ARRAY(
        SELECT DISTINCT LOWER(BTRIM(l))
        FROM UNNEST(COALESCE(v.pref_listing_types, '{}'::TEXT[])) AS l
        WHERE NULLIF(BTRIM(l), '') IS NOT NULL
      ) AS listings,
      LEAST(v.min_budget, v.pref_budget_min)::NUMERIC AS budget_lo,
      GREATEST(v.max_budget, v.pref_budget_max)::NUMERIC AS budget_hi,
      v.pref_bhk_min::NUMERIC AS bhk_lo,
      v.pref_bhk_max::NUMERIC AS bhk_hi
    FROM visible v
    UNION ALL
    SELECT
      v.id,
      LOWER(COALESCE(p ->> 'raw_text', '')),
      ARRAY(
        SELECT DISTINCT a
        FROM UNNEST(
          public.copilot_json_text_array(p -> 'areas')
          || public.copilot_json_text_array(p -> 'projects')
        ) AS a
      ),
      ARRAY(
        SELECT DISTINCT LOWER(t)
        FROM UNNEST(
          public.copilot_json_text_array(p -> 'property_categories')
          || public.copilot_json_text_array(p -> 'property_types')
        ) AS t
      ),
      ARRAY(
        SELECT DISTINCT LOWER(l)
        FROM UNNEST(public.copilot_json_text_array(p -> 'listing_types')) AS l
      ),
      public.copilot_json_number(p -> 'budget_min'),
      public.copilot_json_number(p -> 'budget_max'),
      public.copilot_json_number(p -> 'bhk_min'),
      public.copilot_json_number(p -> 'bhk_max')
    FROM visible v
    CROSS JOIN LATERAL jsonb_array_elements(v.profiles) AS p
    WHERE jsonb_typeof(p) = 'object'
      AND (jsonb_typeof(p -> 'active') <> 'boolean' OR (p ->> 'active')::BOOLEAN)
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
    FROM briefs b
  ),
  scored AS (
    SELECT
      j.contact_id,
      j.matched_area,
      j.budget_lo,
      j.budget_hi,
      (
        CASE WHEN j.matched_area IS NOT NULL THEN 4 WHEN j.area_in_text THEN 2 ELSE 0 END
        + CASE WHEN j.type_match THEN 3 WHEN j.type_in_text THEN 1 ELSE 0 END
        + CASE WHEN (p_budget_min IS NOT NULL OR p_budget_max IS NOT NULL)
                AND (j.budget_lo IS NOT NULL OR j.budget_hi IS NOT NULL) THEN 2 ELSE 0 END
        + CASE WHEN (p_bhk_min IS NOT NULL OR p_bhk_max IS NOT NULL)
                AND (j.bhk_lo IS NOT NULL OR j.bhk_hi IS NOT NULL) THEN 1 ELSE 0 END
      )::INT AS score
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
  best AS (
    SELECT DISTINCT ON (s.contact_id)
      s.contact_id,
      s.matched_area,
      s.budget_lo,
      s.budget_hi,
      s.score
    FROM scored s
    ORDER BY s.contact_id, s.score DESC, s.matched_area NULLS LAST
  ),
  ranked AS (
    SELECT
      v.id,
      v.name,
      v.second_name,
      v.company,
      v.classification,
      b.budget_lo AS min_budget,
      b.budget_hi AS max_budget,
      b.matched_area,
      (b.score + CASE WHEN v.classification IN ('Buyer', 'Owner & Buyer') THEN 1 ELSE 0 END)::INT AS score,
      COUNT(*) OVER ()::BIGINT AS total,
      v.recency
    FROM best b
    JOIN visible v ON v.id = b.contact_id
  )
  SELECT
    r.id,
    r.name,
    r.second_name,
    r.company,
    r.classification,
    r.min_budget,
    r.max_budget,
    r.matched_area,
    r.score,
    r.total
  FROM ranked r
  ORDER BY r.score DESC, r.recency DESC NULLS LAST, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 10);
$$;

REVOKE ALL ON FUNCTION public.copilot_json_text_array(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_json_text_array(JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.copilot_json_number(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_json_number(JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.copilot_regex_literal(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_regex_literal(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.copilot_find_contacts(UUID, JSONB, TEXT[], INT, INT, NUMERIC, NUMERIC, TEXT[], INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_find_contacts(UUID, JSONB, TEXT[], INT, INT, NUMERIC, NUMERIC, TEXT[], INT) TO authenticated;
