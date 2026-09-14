-- Budget band tags follow the numbers.
--
-- "Budget 5-10Cr" and friends are ordinary account tags, so nothing tied
-- them to the budget columns: a buyer whose budget was corrected kept
-- whichever band an agent picked months earlier, and the Contacts filters
-- then disagreed with the matching engine about the same person.
--
-- The band is derived, so it is re-derived on every budget write. This
-- lives in the database rather than in src/lib because both surfaces
-- write contacts directly through supabase-js — a rule in the app layer
-- would be a rule the mobile app can skip.
--
-- Two limits keep this clear of the "tags are proposed, never applied"
-- rule in src/lib/learning/fields.ts: a band is only ever chosen from the
-- budget tags the account already has, and no tag outside that set is
-- ever touched.

CREATE OR REPLACE FUNCTION public.budget_band_unit(p_unit TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(p_unit)
    WHEN 'l' THEN 100000
    WHEN 'lakh' THEN 100000
    WHEN 'lakhs' THEN 100000
    WHEN 'cr' THEN 10000000
    WHEN 'crore' THEN 10000000
    WHEN 'crores' THEN 10000000
  END::NUMERIC;
$$;

CREATE OR REPLACE FUNCTION public.budget_band_bounds(
  p_tag_name TEXT,
  OUT band_min NUMERIC,
  OUT band_max NUMERIC
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts TEXT[];
BEGIN
  band_min := NULL;
  band_max := NULL;

  -- "Budget 150Cr+"
  parts := regexp_match(
    p_tag_name,
    '^\s*budget\s+([0-9]+(\.[0-9]+)?)\s*(l|lakh|lakhs|cr|crore|crores)\s*\+\s*$',
    'i'
  );
  IF parts IS NOT NULL THEN
    band_min := parts[1]::NUMERIC * public.budget_band_unit(parts[3]);
    RETURN;
  END IF;

  -- "Budget 5-10Cr" (unit stated once) and "Budget 20L-50L"
  parts := regexp_match(
    p_tag_name,
    '^\s*budget\s+([0-9]+(\.[0-9]+)?)\s*(l|lakh|lakhs|cr|crore|crores)?\s*(-|to|–)\s*([0-9]+(\.[0-9]+)?)\s*(l|lakh|lakhs|cr|crore|crores)\s*$',
    'i'
  );
  IF parts IS NULL THEN
    RETURN;
  END IF;

  band_min := parts[1]::NUMERIC
    * public.budget_band_unit(COALESCE(parts[3], parts[7]));
  band_max := parts[5]::NUMERIC * public.budget_band_unit(parts[7]);

  IF band_min > band_max THEN
    band_min := NULL;
    band_max := NULL;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.budget_band_bounds(TEXT) IS
  'Rupee bounds of a "Budget 5-10Cr" style tag name. Returns NULLs for any tag that is not a budget band.';

CREATE OR REPLACE FUNCTION public.sync_contact_budget_band(p_contact_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_min NUMERIC;
  v_max NUMERIC;
  v_tag_id UUID;
BEGIN
  SELECT c.account_id,
         COALESCE(NULLIF(c.min_budget, 0), c.pref_budget_min),
         COALESCE(NULLIF(c.max_budget, 0), c.pref_budget_max)
    INTO v_account_id, v_min, v_max
    FROM contacts c
   WHERE c.id = p_contact_id;

  IF v_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- One bound is enough: a buyer who stated only a ceiling still has a band.
  v_min := COALESCE(v_min, v_max);
  v_max := COALESCE(v_max, v_min);

  IF v_min IS NULL OR v_min <= 0 OR v_max <= 0 THEN
    RETURN NULL;
  END IF;

  -- Widest overlap wins; a tie goes to the narrower band, so a 5-6 Cr
  -- buyer lands in "Budget 5-10Cr" rather than a band that swallows it.
  SELECT t.id
    INTO v_tag_id
    FROM tags t
    CROSS JOIN LATERAL public.budget_band_bounds(t.name) b
   WHERE t.account_id = v_account_id
     AND b.band_min IS NOT NULL
     AND LEAST(v_max, COALESCE(b.band_max, 'infinity'::NUMERIC))
         - GREATEST(v_min, b.band_min) >= 0
   ORDER BY LEAST(v_max, COALESCE(b.band_max, 'infinity'::NUMERIC))
            - GREATEST(v_min, b.band_min) DESC,
            COALESCE(b.band_max, 'infinity'::NUMERIC) - b.band_min ASC
   LIMIT 1;

  -- No band fits: leave whatever an agent chose. Nothing is ever minted.
  IF v_tag_id IS NULL THEN
    RETURN NULL;
  END IF;

  DELETE FROM contact_tags ct
   USING tags t
   WHERE ct.contact_id = p_contact_id
     AND ct.tag_id = t.id
     AND t.account_id = v_account_id
     AND t.id <> v_tag_id
     AND (public.budget_band_bounds(t.name)).band_min IS NOT NULL;

  INSERT INTO contact_tags (contact_id, tag_id)
  VALUES (p_contact_id, v_tag_id)
  ON CONFLICT DO NOTHING;

  RETURN v_tag_id;
END;
$$;

COMMENT ON FUNCTION public.sync_contact_budget_band(UUID) IS
  'Attaches the account budget band tag matching a contact budget and removes the bands that contradict it. Mints nothing; ignores non-budget tags.';

CREATE OR REPLACE FUNCTION public.contacts_budget_band_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_contact_budget_band(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_budget_band ON public.contacts;

CREATE TRIGGER sync_budget_band
AFTER INSERT OR UPDATE OF min_budget, max_budget, pref_budget_min, pref_budget_max
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.contacts_budget_band_sync();
