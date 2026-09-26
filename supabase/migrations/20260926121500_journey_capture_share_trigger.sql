-- The share ledger captures the journey pair itself.
--
-- #1059 moved journey capture into the server ledger writer, but the
-- guarantee still lived in TypeScript: a new surface that wrote
-- property_shares directly (agent-account-share.ts does today) would
-- reach the ledger and skip the journey exactly as every surface did
-- from mid-August. An AFTER INSERT trigger makes the pair follow the
-- ledger row whatever wrote it. The ledger row carries the visibility
-- the writer asked for: a share the agent composed for one contact is
-- visible at once, anything else waits in the Captured tray.
--
-- ON CONFLICT DO NOTHING on the ledger means a re-share inserts no row,
-- so the trigger never fires for it and never un-hides or resurrects a
-- pair the agent tucked away. A journey failure is logged and swallowed:
-- the send already happened, and the ledger row must land either way.

ALTER TABLE property_shares
  ADD COLUMN IF NOT EXISTS journey_visible BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.journey_capture_from_share()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage UUID;
  v_item UUID;
BEGIN
  SELECT id INTO v_stage
  FROM journey_stages
  WHERE account_id = NEW.account_id AND pipeline_stage_id IS NOT NULL
  ORDER BY position, id
  LIMIT 1;
  IF v_stage IS NULL THEN
    PERFORM journey_stages_for_account(NEW.account_id);
    SELECT id INTO v_stage
    FROM journey_stages
    WHERE account_id = NEW.account_id AND pipeline_stage_id IS NOT NULL
    ORDER BY position, id
    LIMIT 1;
  END IF;
  IF v_stage IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO journey_items (
    account_id, contact_id, property_id, stage_id, source, hidden, created_by
  )
  VALUES (
    NEW.account_id, NEW.contact_id, NEW.property_id, v_stage,
    'whatsapp_share', NOT NEW.journey_visible, NEW.created_by
  )
  ON CONFLICT (account_id, contact_id, property_id) DO NOTHING
  RETURNING id INTO v_item;

  IF v_item IS NOT NULL THEN
    INSERT INTO journey_events (
      account_id, item_id, event_type, to_stage_id, reason, created_by
    )
    VALUES (
      NEW.account_id, v_item, 'added', v_stage,
      'Captured from WhatsApp share', NEW.created_by
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'journey_capture_from_share: % (share %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.journey_capture_from_share() IS
  'AFTER INSERT on property_shares: captures the contact×property pair on the journey at the account''s first mirrored stage, visible when the ledger row says journey_visible, otherwise hidden in the Captured tray. Existing pairs are left untouched.';

DROP TRIGGER IF EXISTS journey_capture_from_share_trigger ON property_shares;
CREATE TRIGGER journey_capture_from_share_trigger
  AFTER INSERT ON property_shares
  FOR EACH ROW EXECUTE FUNCTION journey_capture_from_share();
