-- A notification often prints a village as "Addoor Village (Gurupura
-- Hobli)", whose spelling key never equals the key of "Adduru".
-- guidance_place_key mirrors placeKey() in src/lib/guidance-value/match.ts:
-- it drops bracketed text and the words village and grama, then applies
-- guidance_spelling_key. The by-key search moves to a new function so the
-- existing one keeps serving until the app stops calling it.

CREATE OR REPLACE FUNCTION guidance_place_key(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.guidance_spelling_key(
    regexp_replace(
      regexp_replace(coalesce(p_text, ''), '\([^)]*\)', ' ', 'g'),
      '\m(village|grama)\M', ' ', 'gi'));
$$;

REVOKE ALL ON FUNCTION guidance_place_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION guidance_place_key(TEXT) TO service_role;

CREATE INDEX IF NOT EXISTS guidance_value_rates_village_place_key_idx
  ON guidance_value_rates (guidance_place_key(village));
CREATE INDEX IF NOT EXISTS guidance_value_rates_locality_place_key_idx
  ON guidance_value_rates (guidance_place_key(locality));

CREATE FUNCTION search_guidance_value_rates_by_place_key(
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
    AND (guidance_place_key(r.village) = p_key
      OR guidance_place_key(r.locality) = p_key)
  ORDER BY s.effective_from DESC NULLS LAST
  LIMIT LEAST(GREATEST(coalesce(p_limit, 80), 1), 200);
$$;

REVOKE ALL ON FUNCTION search_guidance_value_rates_by_place_key(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_guidance_value_rates_by_place_key(TEXT, TEXT, INTEGER) TO service_role;
