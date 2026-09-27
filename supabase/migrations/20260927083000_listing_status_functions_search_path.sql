-- Hardens the two functions from 20260927080000_listing_status_from_deals.
--
-- Both run as their owner. With search_path = public, PostgreSQL still
-- looks in the session's temporary schema first for an unqualified
-- table name, so a session able to create a temporary table named
-- properties or deals could shadow the real one inside the function.
-- Naming pg_temp explicitly, last, closes that. The bodies are
-- otherwise unchanged.
--
-- The listing's status now comes from its deals alone, read under the
-- row lock. p_requested is still validated but no longer weighs in:
-- every caller writes its deal before syncing, so the deals already say
-- what the request would, and a stale request that arrives last can no
-- longer overwrite a newer deal state.
--
-- Held until merge: CREATE OR REPLACE on functions that already exist.

CREATE OR REPLACE FUNCTION sync_listing_status_from_deals(
  p_account_id UUID,
  p_property_id UUID,
  p_requested TEXT
)
RETURNS TABLE (previous_status TEXT, new_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous TEXT;
  v_held INTEGER;
  v_target TEXT;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not an agent on this account' USING ERRCODE = '42501';
  END IF;
  IF p_requested NOT IN ('Available', 'Under Contract', 'Sold') THEN
    RAISE EXCEPTION 'unsupported listing status %', p_requested
      USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_previous
  FROM properties
  WHERE id = p_property_id AND account_id = p_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(MAX(
    CASE
      WHEN d.status = 'won' THEN 2
      WHEN lower(btrim(COALESCE(s.name, ''))) LIKE '%lost%' THEN 0
      WHEN lower(btrim(COALESCE(s.name, ''))) ~ '(won|registered|brokerage)' THEN 2
      WHEN lower(btrim(COALESCE(s.name, ''))) ~ '(negotiation|token|due diligence|contract)' THEN 1
      ELSE 0
    END
  ), 0)
  INTO v_held
  FROM deals d
  LEFT JOIN pipeline_stages s ON s.id = d.stage_id
  WHERE d.account_id = p_account_id
    AND d.property_id = p_property_id
    AND d.status IN ('open', 'won');

  v_target := CASE v_held
    WHEN 2 THEN 'Sold'
    WHEN 1 THEN 'Under Contract'
    ELSE 'Available'
  END;

  UPDATE properties
  SET status = v_target
  WHERE id = p_property_id AND account_id = p_account_id;

  RETURN QUERY SELECT v_previous, v_target;
END;
$$;

REVOKE ALL ON FUNCTION sync_listing_status_from_deals(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sync_listing_status_from_deals(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION sync_listing_status_from_deals(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION journey_deal_listings(
  p_account_id UUID,
  p_mode TEXT,
  p_subject_id UUID
)
RETURNS SETOF UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'not an agent on this account' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('buyer', 'property') THEN
    RAISE EXCEPTION 'unsupported journey mode %', p_mode USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT DISTINCT d.property_id
    FROM deals d
    JOIN journey_items ji
      ON ji.id = d.source_journey_item_id
     AND ji.account_id = p_account_id
    WHERE d.account_id = p_account_id
      AND d.property_id IS NOT NULL
      AND CASE p_mode
            WHEN 'buyer' THEN ji.contact_id = p_subject_id
            ELSE ji.property_id = p_subject_id
          END;
END;
$$;

REVOKE ALL ON FUNCTION journey_deal_listings(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION journey_deal_listings(UUID, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION journey_deal_listings(UUID, TEXT, UUID) TO authenticated;
