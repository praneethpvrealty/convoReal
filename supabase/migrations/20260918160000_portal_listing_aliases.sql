-- A property can receive enquiries under more than one ad id from the same
-- portal (reposts, refreshed campaigns and legacy ids). The posting tracker
-- keeps one current row per property/portal; aliases retain every additional
-- id without replacing that current row.

CREATE TABLE IF NOT EXISTS public.property_portal_listing_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  portal TEXT NOT NULL CHECK (portal IN ('99acres', 'magicbricks', 'housing')),
  portal_listing_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, portal, portal_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_listing_aliases_property
  ON public.property_portal_listing_aliases (property_id);

ALTER TABLE public.property_portal_listing_aliases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.property_portal_listing_aliases FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.property_portal_listing_aliases TO authenticated;

DROP POLICY IF EXISTS "Members read own portal listing aliases"
  ON public.property_portal_listing_aliases;
CREATE POLICY "Members read own portal listing aliases"
  ON public.property_portal_listing_aliases FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Agents create own portal listing aliases"
  ON public.property_portal_listing_aliases;
CREATE POLICY "Agents create own portal listing aliases"
  ON public.property_portal_listing_aliases FOR INSERT
  TO authenticated
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents update own portal listing aliases"
  ON public.property_portal_listing_aliases;
CREATE POLICY "Agents update own portal listing aliases"
  ON public.property_portal_listing_aliases FOR UPDATE
  TO authenticated
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents delete own portal listing aliases"
  ON public.property_portal_listing_aliases;
CREATE POLICY "Agents delete own portal listing aliases"
  ON public.property_portal_listing_aliases FOR DELETE
  TO authenticated
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.guard_portal_listing_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.portal_listing_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'property_portal_listings' AND EXISTS (
    SELECT 1
    FROM property_portal_listing_aliases ppla
    WHERE ppla.account_id = NEW.account_id
      AND ppla.portal = NEW.portal
      AND ppla.portal_listing_id = NEW.portal_listing_id
  ) THEN
    RAISE EXCEPTION 'portal listing id is already retained as an alias'
      USING ERRCODE = '23505';
  END IF;

  IF TG_TABLE_NAME = 'property_portal_listing_aliases' AND EXISTS (
    SELECT 1
    FROM property_portal_listings ppl
    WHERE ppl.account_id = NEW.account_id
      AND ppl.portal = NEW.portal
      AND ppl.portal_listing_id = NEW.portal_listing_id
  ) THEN
    RAISE EXCEPTION 'portal listing id is already the current listing id'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_portal_listing_identity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_primary_portal_listing_identity
  ON public.property_portal_listings;
CREATE TRIGGER trg_guard_primary_portal_listing_identity
  BEFORE INSERT OR UPDATE OF account_id, portal, portal_listing_id
  ON public.property_portal_listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_portal_listing_identity();

DROP TRIGGER IF EXISTS trg_guard_alias_portal_listing_identity
  ON public.property_portal_listing_aliases;
CREATE TRIGGER trg_guard_alias_portal_listing_identity
  BEFORE INSERT OR UPDATE OF account_id, portal, portal_listing_id
  ON public.property_portal_listing_aliases
  FOR EACH ROW EXECUTE FUNCTION public.guard_portal_listing_identity();

CREATE OR REPLACE FUNCTION public.unmapped_portal_ads(target_account_id UUID)
RETURNS TABLE (
  portal TEXT,
  portal_listing_id TEXT,
  lead_count BIGINT,
  last_seen_at TIMESTAMPTZ,
  sample_contact_id UUID,
  sample_contact_name TEXT,
  guessed_property_id UUID,
  guessed_property_title TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    latest.lead_portal,
    latest.lead_portal_listing_id,
    latest.lead_count,
    latest.last_seen_at,
    latest.id,
    latest.name,
    latest.last_inquired_property_id,
    p.title
  FROM (
    SELECT DISTINCT ON (c.lead_portal, c.lead_portal_listing_id)
      c.lead_portal,
      c.lead_portal_listing_id,
      c.id,
      c.name,
      c.last_inquired_property_id,
      COUNT(*) OVER (PARTITION BY c.lead_portal, c.lead_portal_listing_id) AS lead_count,
      MAX(c.created_at) OVER (PARTITION BY c.lead_portal, c.lead_portal_listing_id) AS last_seen_at
    FROM contacts c
    WHERE c.account_id = target_account_id
      AND c.lead_portal IS NOT NULL
      AND c.lead_portal_listing_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM property_portal_listings ppl
        WHERE ppl.account_id = target_account_id
          AND ppl.portal = c.lead_portal
          AND ppl.portal_listing_id = c.lead_portal_listing_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM property_portal_listing_aliases ppla
        WHERE ppla.account_id = target_account_id
          AND ppla.portal = c.lead_portal
          AND ppla.portal_listing_id = c.lead_portal_listing_id
      )
    ORDER BY c.lead_portal, c.lead_portal_listing_id, c.created_at DESC
  ) AS latest
  LEFT JOIN properties p
    ON p.id = latest.last_inquired_property_id
   AND p.account_id = target_account_id
  WHERE is_account_member(target_account_id)
  ORDER BY latest.last_seen_at DESC
  LIMIT 100;
$$;

REVOKE EXECUTE ON FUNCTION public.unmapped_portal_ads(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmapped_portal_ads(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unmap_portal_ad(
  p_account_id UUID,
  p_portal TEXT,
  p_portal_listing_id TEXT
)
RETURNS TABLE (
  property_id UUID,
  untagged_contacts BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id UUID;
  v_untagged BIGINT;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not a member of this account'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM property_portal_listing_aliases ppla
    WHERE ppla.account_id = p_account_id
      AND ppla.portal = p_portal
      AND ppla.portal_listing_id = p_portal_listing_id
    RETURNING ppla.property_id INTO v_property_id;

  IF v_property_id IS NULL THEN
    UPDATE property_portal_listings ppl
      SET portal_listing_id = NULL
      WHERE ppl.account_id = p_account_id
        AND ppl.portal = p_portal
        AND ppl.portal_listing_id = p_portal_listing_id
      RETURNING ppl.property_id INTO v_property_id;
  END IF;

  IF v_property_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM contact_property_inquiries cpi
    WHERE cpi.property_id = v_property_id
      AND cpi.inquiry_source = p_portal
      AND EXISTS (
        SELECT 1 FROM contacts c
        WHERE c.id = cpi.contact_id
          AND c.account_id = p_account_id
          AND c.lead_portal = p_portal
          AND c.lead_portal_listing_id = p_portal_listing_id
          AND c.last_inquired_property_id = v_property_id
      );

  WITH cleared AS (
    UPDATE contacts c
      SET last_inquired_property_id = NULL,
          updated_at = NOW()
      WHERE c.account_id = p_account_id
        AND c.lead_portal = p_portal
        AND c.lead_portal_listing_id = p_portal_listing_id
        AND c.last_inquired_property_id = v_property_id
      RETURNING c.id
  )
  SELECT count(*) INTO v_untagged FROM cleared;

  RETURN QUERY SELECT v_property_id, v_untagged;
END;
$$;

REVOKE ALL ON FUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmap_portal_ad(UUID, TEXT, TEXT) TO authenticated;
