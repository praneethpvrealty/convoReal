-- Spelling-tolerant lookup for guidance value rates. RTC names are
-- transliterated from Kannada, so the same village is printed as Bheema or
-- Bima, Adduru or Addur, and trigram similarity can fall below the search
-- threshold. guidance_spelling_key mirrors placeKey() in
-- src/lib/guidance-value/match.ts: per word, drop aspirates, sh -> s,
-- w -> v, ee -> i, oo/ou -> u, collapse doubled letters and drop a trailing
-- vowel from words longer than three letters. The search requires a
-- district pattern so it never scans the whole state.

CREATE OR REPLACE FUNCTION guidance_spelling_key(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(string_agg(
    CASE
      WHEN w ~ '\d' THEN w
      WHEN length(k) > 3 THEN regexp_replace(k, '[aeiu]$', '')
      ELSE k
    END, ' ' ORDER BY n), '')
  FROM (
    SELECT w, n,
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(w, '([bcdgjkpt])h', '\1', 'g'),
                'sh', 's', 'g'),
              'w', 'v', 'g'),
            'ee', 'i', 'g'),
          'oo|ou', 'u', 'g'),
        '(.)\1+', '\1', 'g') AS k
    FROM regexp_split_to_table(
      trim(regexp_replace(
        regexp_replace(lower(coalesce(p_text, '')), '(\d+)\s*(st|nd|rd|th)\M', '\1', 'g'),
        '[^a-z0-9]+', ' ', 'g')),
      ' ') WITH ORDINALITY AS t(w, n)
    WHERE w <> ''
  ) words;
$$;

CREATE INDEX IF NOT EXISTS guidance_value_rates_village_key_idx
  ON guidance_value_rates (guidance_spelling_key(village));
CREATE INDEX IF NOT EXISTS guidance_value_rates_locality_key_idx
  ON guidance_value_rates (guidance_spelling_key(locality));

CREATE OR REPLACE FUNCTION search_guidance_value_rates_by_key(
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

REVOKE ALL ON FUNCTION guidance_spelling_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION guidance_spelling_key(TEXT) TO service_role;
REVOKE ALL ON FUNCTION search_guidance_value_rates_by_key(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_guidance_value_rates_by_key(TEXT, TEXT, INTEGER) TO service_role;
