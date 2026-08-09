-- ============================================================
-- Multi-unit listings: a project, and the units inside it.
--
-- A tower of flats was previously N unrelated properties sharing a
-- `project` TEXT string. That string is enough to group them on the
-- public /projects/[slug] page and to score a named-project match, but
-- it holds nothing: the map pin, the amenities, the brochure and the
-- possession date were retyped onto every unit, and nothing could say
-- "12 units, 3 sold, from ₹8,200/sqft".
--
-- A unit stays a `properties` row. Units are what get sold, shared,
-- matched, digested to owners and bid on, and every one of those
-- systems is built on properties — a separate units table would orphan
-- all of it. So this adds the project as a real row and points each
-- unit at it.
--
-- `properties.project` (TEXT) stays, and stays authoritative for the
-- 46 call sites that read it. The trigger below keeps it equal to the
-- linked project's name so nothing that reads the string has to know
-- projects exist yet.
--
-- rera_projects is a GLOBAL registry (no account_id) synced from the
-- RERA portal. It is a lookup, not an account's inventory — so a
-- project may reference one to inherit its promoter, completion date
-- and registration number, and a project with no RERA registration
-- (a landowner share, a resale tower) simply leaves it null.
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  /** Stable public identifier. Derived from the name on insert, but
   *  stored so a rename never breaks a link already shared. */
  slug TEXT NOT NULL,
  /** The registry row this project is, when it is registered. */
  rera_project_id UUID REFERENCES rera_projects(id) ON DELETE SET NULL,
  builder TEXT,
  location TEXT,
  sublocality TEXT,
  city TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  /** Facts every unit shares, stated once rather than per unit. */
  amenities TEXT[] DEFAULT '{}',
  images TEXT[] DEFAULT '{}',
  brochure_url TEXT,
  description TEXT,
  possession_date DATE,
  /** As declared by the builder. The count of linked units is a
   *  different number — what this brokerage happens to hold — and is
   *  derived, never stored. */
  total_units INTEGER,
  total_floors INTEGER,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One project per slug per account: two towers with the same name in
-- one brokerage would make /projects/<slug> ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS projects_account_slug_key
  ON projects (account_id, slug);

CREATE INDEX IF NOT EXISTS idx_projects_account ON projects (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON projects;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS projects_modify ON projects;
CREATE POLICY projects_modify ON projects
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ── The unit side ────────────────────────────────────────────

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- "A-1402". Free text because numbering conventions are not ours to
-- impose — G03, 1402, Villa 7 and Shop 2B are all real.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS unit_no TEXT;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS tower TEXT;

CREATE INDEX IF NOT EXISTS idx_properties_project_id
  ON properties (project_id) WHERE project_id IS NOT NULL;

-- ── Keeping the legacy string honest ─────────────────────────
--
-- Every existing reader of properties.project keeps working, because
-- linking a unit sets the string from the project's name and a project
-- rename carries to its units. Unlinking leaves the last known name in
-- place rather than blanking it — the unit is still in that project,
-- it just is not tracked as one any more.

CREATE OR REPLACE FUNCTION public.sync_property_project_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT name INTO NEW.project FROM projects WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_project_name ON properties;
CREATE TRIGGER sync_project_name
  BEFORE INSERT OR UPDATE OF project_id ON properties
  FOR EACH ROW EXECUTE FUNCTION public.sync_property_project_name();

CREATE OR REPLACE FUNCTION public.sync_units_on_project_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE properties SET project = NEW.name WHERE project_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_units_on_rename ON projects;
CREATE TRIGGER sync_units_on_rename AFTER UPDATE OF name ON projects
  FOR EACH ROW EXECUTE FUNCTION public.sync_units_on_project_rename();

COMMENT ON COLUMN properties.project_id IS
  'The project this unit belongs to. properties.project holds the same name as text and stays authoritative for readers that predate this column.';

-- ── "Starting from ₹X per sqft" ──────────────────────────────
--
-- Derived, never stored. A stored floor price goes stale the day the
-- cheapest unit sells; computed, it corrects itself — and a premium
-- unit needs no special handling, it just carries a higher price and
-- stops being the minimum.
--
-- Only AVAILABLE units count toward the floor: quoting a price that
-- can no longer be bought is the fault this exists to avoid. Units
-- with no area or no price are excluded from the rate rather than
-- counted as zero.
--
-- Same SECURITY DEFINER shape as inventory_stats (migration 168): the
-- membership guard runs once in the WHERE clause, so a non-member gets
-- no rows rather than another account's inventory.
CREATE OR REPLACE FUNCTION public.project_unit_stats(p_account_id UUID)
RETURNS TABLE (
  project_id UUID,
  units BIGINT,
  available BIGINT,
  sold_or_contract BIGINT,
  min_price NUMERIC,
  max_price NUMERIC,
  min_rate_per_sqft NUMERIC,
  max_rate_per_sqft NUMERIC,
  min_bedrooms INTEGER,
  max_bedrooms INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.project_id,
    count(*),
    count(*) FILTER (WHERE p.status = 'Available'),
    count(*) FILTER (WHERE p.status IN ('Sold', 'Under Contract')),
    min(p.price) FILTER (WHERE p.status = 'Available' AND p.price > 0),
    max(p.price) FILTER (WHERE p.status = 'Available' AND p.price > 0),
    min(p.price / p.area_sqft) FILTER (
      WHERE p.status = 'Available' AND p.price > 0 AND p.area_sqft > 0
    ),
    max(p.price / p.area_sqft) FILTER (
      WHERE p.status = 'Available' AND p.price > 0 AND p.area_sqft > 0
    ),
    min(p.bedrooms) FILTER (WHERE p.bedrooms > 0),
    max(p.bedrooms) FILTER (WHERE p.bedrooms > 0)
  FROM properties p
  WHERE p.account_id = p_account_id
    AND p.project_id IS NOT NULL
    AND is_account_member(p_account_id, 'viewer')
  GROUP BY p.project_id;
$$;

GRANT EXECUTE ON FUNCTION public.project_unit_stats(UUID) TO authenticated;
