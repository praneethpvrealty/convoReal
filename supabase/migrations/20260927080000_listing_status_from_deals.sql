-- A deal moves its listing's status, and a listing can carry more than
-- one deal. Reading the listing's deals and writing its status used to
-- be two separate round trips from the app, so two deal changes landing
-- together could each compute from a stale set of deals and the last
-- write won — a listing released to Available while another deal had
-- just gone to Negotiation, with an "available again" message to its
-- enquirers on the way.
--
-- sync_listing_status_from_deals does the read and the write in one
-- transaction, holding the listing's row lock, and returns the status
-- before and after so the app decides whether to tell enquirers. The
-- listing takes the strongest of the requested status and the status
-- its open and won deals hold: Sold, then Under Contract, then
-- Available. The stage rules mirror propertyStatusForPipelineStage in
-- src/lib/pipelines/stage-semantics.ts; listing-status-sync.test.ts
-- fails if the two drift.
--
-- journey_deal_listings returns every listing with a deal on one
-- journey, so closing or reopening a journey can re-sync them without
-- shipping the journey's item ids through a URL.
--
-- Additive: two new functions, nothing existing changes.

CREATE OR REPLACE FUNCTION sync_listing_status_from_deals(
  p_account_id UUID,
  p_property_id UUID,
  p_requested TEXT
)
RETURNS TABLE (previous_status TEXT, new_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  v_target := CASE
    WHEN v_held = 2 OR p_requested = 'Sold' THEN 'Sold'
    WHEN v_held = 1 OR p_requested = 'Under Contract' THEN 'Under Contract'
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
SET search_path = public
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
