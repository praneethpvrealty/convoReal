-- Guidance value lookup.
--
-- Karnataka publishes guidance values (the government's minimum value
-- per unit area, used for stamp duty) as PDF notifications per district
-- and sub-registrar office. There is no API. A platform admin uploads a
-- notification once; its rows are parsed into guidance_value_rates, and
-- every later lookup matches a sale deed's schedule against that table.
--
-- guidance_value_sources and guidance_value_rates are public government
-- data shared by every tenant, so they deliberately carry no account_id.
-- RLS is enabled with no policies: only the service role reaches them,
-- through /api/admin/guidance-values (super_admin) for writes and
-- /api/guidance-value/lookup for reads.

CREATE TABLE IF NOT EXISTS guidance_value_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code TEXT NOT NULL DEFAULT 'KA',
  district TEXT NOT NULL,
  taluk TEXT,
  sro TEXT,
  title TEXT NOT NULL,
  effective_from DATE,
  storage_path TEXT NOT NULL,
  page_count INTEGER,
  pages_parsed INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'parsing', 'ready', 'failed')),
  error TEXT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON guidance_value_sources;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON guidance_value_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE guidance_value_sources ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS guidance_value_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES guidance_value_sources(id) ON DELETE CASCADE,
  district TEXT,
  taluk TEXT,
  hobli TEXT,
  village TEXT,
  locality TEXT,
  road TEXT,
  survey_numbers TEXT,
  property_class TEXT NOT NULL CHECK (property_class IN (
    'residential_site',
    'residential_apartment',
    'commercial_site',
    'commercial_apartment',
    'industrial',
    'agricultural',
    'other'
  )),
  rate NUMERIC NOT NULL CHECK (rate > 0),
  unit TEXT NOT NULL CHECK (unit IN ('sqm', 'sqft', 'acre', 'gunta', 'hectare')),
  page INTEGER,
  search_text TEXT GENERATED ALWAYS AS (
    lower(
      coalesce(village, '') || ' ' ||
      coalesce(locality, '') || ' ' ||
      coalesce(road, '') || ' ' ||
      coalesce(hobli, '') || ' ' ||
      coalesce(taluk, '')
    )
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guidance_value_rates_source
  ON guidance_value_rates (source_id, page);

DROP TRIGGER IF EXISTS set_updated_at ON guidance_value_rates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON guidance_value_rates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE guidance_value_rates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION search_guidance_value_rates(
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

CREATE TABLE IF NOT EXISTS property_guidance_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  rate_id UUID REFERENCES guidance_value_rates(id) ON DELETE SET NULL,
  rate_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  land_area_sqft NUMERIC,
  built_up_area_sqft NUMERIC,
  land_value NUMERIC,
  building_value NUMERIC,
  total_value NUMERIC NOT NULL CHECK (total_value >= 0),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (property_id IS NOT NULL OR deal_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_property_guidance_values_property
  ON property_guidance_values (property_id, created_at DESC)
  WHERE property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_guidance_values_deal
  ON property_guidance_values (deal_id, created_at DESC)
  WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_guidance_values_account
  ON property_guidance_values (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON property_guidance_values;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON property_guidance_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE property_guidance_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_guidance_values_select ON property_guidance_values;
CREATE POLICY property_guidance_values_select ON property_guidance_values FOR SELECT USING (
  is_account_member(account_id)
);

DROP POLICY IF EXISTS property_guidance_values_insert ON property_guidance_values;
CREATE POLICY property_guidance_values_insert ON property_guidance_values FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent')
);

DROP POLICY IF EXISTS property_guidance_values_delete ON property_guidance_values;
CREATE POLICY property_guidance_values_delete ON property_guidance_values FOR DELETE USING (
  is_account_member(account_id, 'agent')
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'guidance-value-sources',
  'guidance-value-sources',
  FALSE,
  52428800,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
