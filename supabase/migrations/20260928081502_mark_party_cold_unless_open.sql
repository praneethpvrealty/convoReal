-- ============================================================
-- 20260928081502_mark_party_cold_unless_open.sql — Mark cold decides
-- "no enquiry is still open" and sets the lead COLD in one step that no
-- new enquiry can slip between (INB-021).
--
-- The follow-up card's Mark cold read the party's open enquiries and then
-- updated contacts.lead_temp in a separate request, so an enquiry opened
-- between the two left the lead COLD with a live branch. The function
-- locks the party's contact rows, checks for an active branch, and only
-- then cools them, all in one transaction.
--
-- A branch becomes active by INSERT (whose contact foreign key already
-- takes a KEY SHARE lock on the contact row) or by an upsert that flips a
-- dropped branch back to active (which takes no lock on the contact).
-- The trigger takes that same KEY SHARE lock for both, so a writer and
-- Mark cold on the same contact run one after the other: an enquiry that
-- lands first is seen and keeps the lead hot, and one that lands after
-- finds the lead already cold.
--
-- The past-enquiry stage kinds are passed in by the caller, which reads
-- them from PAST_ENQUIRY_STAGE_KINDS, so the rule lives in one place.
--
-- Purely additive: a new function and a new trigger; the trigger only
-- takes a row lock the insert path already takes. Idempotent.
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

CREATE OR REPLACE FUNCTION public.journey_item_lock_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM contacts WHERE id = NEW.contact_id FOR KEY SHARE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journey_item_lock_contact ON journey_items;
CREATE TRIGGER trg_journey_item_lock_contact
  BEFORE INSERT OR UPDATE OF status, contact_id ON journey_items
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.journey_item_lock_contact();
