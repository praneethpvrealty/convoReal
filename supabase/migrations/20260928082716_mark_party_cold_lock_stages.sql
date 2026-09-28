-- ============================================================
-- 20260928082716_mark_party_cold_lock_stages.sql — Mark cold also waits
-- for any change that can turn an existing branch into an open enquiry
-- without inserting or reactivating it (INB-021).
--
-- 20260928081502 serialised Mark cold with a branch becoming active. Two
-- other writes can make a branch count as open, and neither took the
-- contact lock:
--   * moving an active branch to another stage (journey_items.stage_id),
--     for example out of closing back to an earlier stage;
--   * renaming a mirrored pipeline stage, which rewrites
--     journey_stages.stage_kind (journey_stages_mirror_pipeline) and so
--     reclassifies every branch at that stage at once.
-- The trigger now also fires on a stage_id change, and the function takes
-- a FOR SHARE lock on the account's journey stages before it looks for an
-- open branch, so a stage rewrite and Mark cold run one after the other.
--
-- Not additive: it replaces mark_party_cold_unless_open and the trigger
-- from 20260928081502, so it is applied once its pull request has merged
-- to main. The app works with either version of the function. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_party_cold_unless_open(
  p_account_id uuid,
  p_contact_ids uuid[],
  p_past_stage_kinds text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_open uuid[];
  v_cooled integer;
BEGIN
  PERFORM 1
  FROM contacts c
  WHERE c.account_id = p_account_id
    AND c.id = ANY (p_contact_ids)
  ORDER BY c.id
  FOR UPDATE;

  PERFORM 1
  FROM journey_stages s
  WHERE s.account_id = p_account_id
  ORDER BY s.id
  FOR SHARE;

  SELECT array_agg(DISTINCT ji.property_id)
  INTO v_open
  FROM journey_items ji
  LEFT JOIN journey_stages s ON s.id = ji.stage_id
  WHERE ji.account_id = p_account_id
    AND ji.contact_id = ANY (p_contact_ids)
    AND ji.status = 'active'
    AND (s.stage_kind IS NULL OR NOT (s.stage_kind = ANY (p_past_stage_kinds)));

  IF v_open IS NOT NULL THEN
    RETURN jsonb_build_object('cooled', 0, 'open_property_ids', to_jsonb(v_open));
  END IF;

  UPDATE contacts
  SET lead_temp = 'COLD', updated_at = now()
  WHERE account_id = p_account_id
    AND id = ANY (p_contact_ids);
  GET DIAGNOSTICS v_cooled = ROW_COUNT;

  RETURN jsonb_build_object('cooled', v_cooled, 'open_property_ids', '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_party_cold_unless_open(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_party_cold_unless_open(uuid, uuid[], text[]) TO service_role;

DROP TRIGGER IF EXISTS trg_journey_item_lock_contact ON journey_items;
CREATE TRIGGER trg_journey_item_lock_contact
  BEFORE INSERT OR UPDATE OF status, contact_id, stage_id ON journey_items
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.journey_item_lock_contact();
