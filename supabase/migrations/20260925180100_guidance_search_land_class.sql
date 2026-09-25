-- The rate search functions return each rate's land class. A changed
-- result type cannot be applied with CREATE OR REPLACE, so both functions
-- are dropped and recreated with their existing bodies plus land_class.

DROP FUNCTION IF EXISTS search_guidance_value_rates(TEXT, TEXT, INTEGER);

CREATE FUNCTION search_guidance_value_rates(
  p_query TEXT,
  p_district_pattern TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 60
)
RETURNS TABLE (
  id UUID,
  source_id UUID,
  district TEXT,
  taluk TEXT,
  hobli TEXT,
  village TEXT,
  locality TEXT,
  road TEXT,
  survey_numbers TEXT,
  property_class TEXT,
  land_class TEXT,
  rate NUMERIC,
  unit TEXT,
  page INTEGER,
  source_title TEXT,
  effective_from DATE,
  similarity REAL
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    r.id,
    r.source_id,
    r.district,
    r.taluk,
    r.hobli,
    r.village,
    r.locality,
    r.road,
    r.survey_numbers,
    r.property_class,
    r.land_class,
    r.rate,
    r.unit,
    r.page,
    s.title,
    s.effective_from,
    word_similarity(lower(p_query), r.search_text) AS similarity
  FROM guidance_value_rates r
  JOIN guidance_value_sources s ON s.id = r.source_id
  WHERE s.status IN ('parsing', 'ready')
    AND (p_district_pattern IS NULL OR s.district ~* p_district_pattern OR r.district ~* p_district_pattern)
    AND word_similarity(lower(p_query), r.search_text) >= 0.3
  ORDER BY similarity DESC, s.effective_from DESC NULLS LAST
  LIMIT LEAST(GREATEST(coalesce(p_limit, 60), 1), 200);
$$;

REVOKE ALL ON FUNCTION search_guidance_value_rates(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_guidance_value_rates(TEXT, TEXT, INTEGER) TO service_role;

DROP FUNCTION IF EXISTS search_guidance_value_rates_by_key(TEXT, TEXT, INTEGER);

CREATE FUNCTION search_guidance_value_rates_by_key(
  p_key TEXT,
  p_district_pattern TEXT,
  p_limit INTEGER DEFAULT 80
)
RETURNS TABLE (
  id UUID,
  source_id UUID,
  district TEXT,
  taluk TEXT,
  hobli TEXT,
  village TEXT,
  locality TEXT,
  road TEXT,
  survey_numbers TEXT,
  property_class TEXT,
  land_class TEXT,
  rate NUMERIC,
  unit TEXT,
  page INTEGER,
  source_title TEXT,
  effective_from DATE,
  similarity REAL
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    r.id,
    r.source_id,
    r.district,
    r.taluk,
    r.hobli,
    r.village,
    r.locality,
    r.road,
    r.survey_numbers,
    r.property_class,
    r.land_class,
    r.rate,
    r.unit,
    r.page,
    s.title,
    s.effective_from,
    1::REAL AS similarity
  FROM guidance_value_rates r
  JOIN guidance_value_sources s ON s.id = r.source_id
  WHERE coalesce(p_key, '') <> ''
    AND coalesce(p_district_pattern, '') <> ''
    AND s.status IN ('parsing', 'ready')
    AND (s.district ~* p_district_pattern OR r.district ~* p_district_pattern)
    AND (guidance_spelling_key(r.village) = p_key
      OR guidance_spelling_key(r.locality) = p_key)
  ORDER BY s.effective_from DESC NULLS LAST
  LIMIT LEAST(GREATEST(coalesce(p_limit, 80), 1), 200);
$$;

REVOKE ALL ON FUNCTION search_guidance_value_rates_by_key(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_guidance_value_rates_by_key(TEXT, TEXT, INTEGER) TO service_role;
