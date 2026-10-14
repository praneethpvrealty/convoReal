-- Non-additive follow-up to 20261014023548: apply only once this change
-- is merged into main.
--
-- The two policies matched profiles.id against auth.uid(); the auth id
-- lives in profiles.user_id, so no member could read the queue at all.
-- Reads follow is_account_member and the write follows is_account_writer
-- like every other workspace table.
ALTER POLICY "account members read own notices" ON public.deal_status_notifications
  USING (is_account_member(account_id));
ALTER POLICY "account members update own notices" ON public.deal_status_notifications
  USING (is_account_writer(account_id, 'agent'))
  WITH CHECK (is_account_writer(account_id, 'agent'));

-- The 'won' text thanked the buyer by one brokerage's name, which is
-- wrong for every other account. The account's own name signs it now,
-- and an account with no name set thanks the buyer without one. A
-- counterpart with no phone is queued all the same: the drain records
-- the skip and its reason, so every reachable counterpart leaves a row
-- (a stakeholder with neither a contact nor a phone is not one). Every
-- contact and property these definer functions read is scoped to the
-- row's own account: a deal can name a contact id from another tenant,
-- and that tenant's name and phone must not be copied into a row this
-- account can read.
CREATE OR REPLACE FUNCTION public.queue_deal_status_notice(
  p_account_id uuid, p_contact_id uuid, p_name text, p_phone text, p_role text,
  p_property_id uuid, p_deal_id uuid, p_journey_item_id uuid, p_event text, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prop_title text;
  v_owner uuid;
  v_brand text;
  v_msg text;
BEGIN
  SELECT title, owner_contact_id INTO v_prop_title, v_owner FROM properties WHERE id = p_property_id AND account_id = p_account_id;
  IF p_contact_id IS NOT NULL AND v_owner IS NOT NULL AND p_contact_id = v_owner THEN RETURN; END IF;

  SELECT NULLIF(TRIM(name), '') INTO v_brand FROM accounts WHERE id = p_account_id;

  v_msg := CASE p_event
    WHEN 'won' THEN format(
      'Update on %s: the transaction has been concluded. Thank you for your trust%s. We will stay in touch on the remaining formalities.',
      COALESCE(v_prop_title, 'the property'),
      COALESCE(' in ' || v_brand, ''))
    WHEN 'property_sold' THEN format(
      'Update on %s: this property has been sold and is no longer available. We will share comparable options matching your requirement shortly.',
      COALESCE(v_prop_title, 'the property'))
    ELSE format(
      'Update on %s: this transaction will not be proceeding further. We will keep you posted on similar options that match your requirement.',
      COALESCE(v_prop_title, 'the property'))
  END;

  INSERT INTO deal_status_notifications
    (account_id, contact_id, recipient_name, recipient_phone, recipient_role, property_id, deal_id, journey_item_id, event, internal_reason, message_text)
  VALUES (p_account_id, p_contact_id, p_name, p_phone, p_role, p_property_id, p_deal_id, p_journey_item_id, p_event, p_reason, v_msg)
  ON CONFLICT DO NOTHING;
END;
$$;

-- A contact and property pair can carry more than one deal, and only the
-- one opened from this journey branch is the one the drop closes. A deal
-- the pair merely shares is left alone: attaching it would make the
-- drain judge the notice by that deal's status instead of the branch.
CREATE OR REPLACE FUNCTION public.on_journey_item_dropped() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  d record;
BEGIN
  PERFORM auto_close_todos(new.account_id, new.contact_id, new.property_id,
    'journey dropped' || coalesce(' — ' || new.drop_reason, ''));

  SELECT id, name, phone INTO c FROM contacts WHERE id = new.contact_id AND account_id = new.account_id;
  SELECT id, status INTO d
    FROM deals
   WHERE account_id = new.account_id
     AND source_journey_item_id = new.id
   ORDER BY updated_at DESC
   LIMIT 1;

  PERFORM queue_deal_status_notice(new.account_id, c.id, c.name, c.phone, 'buyer',
    new.property_id, d.id, new.id, CASE WHEN d.status = 'lost' THEN 'lost' ELSE 'dropped' END, new.drop_reason);

  IF d.id IS NOT NULL THEN
    INSERT INTO deal_status_notifications
      (account_id, contact_id, recipient_name, recipient_phone, recipient_role, property_id, deal_id, journey_item_id, event, internal_reason, message_text)
    SELECT s.account_id, s.contact_id, s.name, s.phone, s.role, new.property_id, d.id, new.id, 'lost', new.drop_reason,
           format('Update on %s: this transaction will not be proceeding further. Thank you for your support.', COALESCE((SELECT title FROM properties WHERE id = new.property_id AND account_id = new.account_id), 'the property'))
      FROM deal_stakeholders s
     WHERE s.deal_id = d.id AND s.account_id = new.account_id AND s.side = 'buyer'
       AND (s.contact_id IS NOT NULL OR s.phone IS NOT NULL)
       AND (s.contact_id IS NULL OR s.contact_id <> new.contact_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN new;
END;
$$;

-- A property leaving the market closes the follow-ups buyers had on it,
-- not the brokerage's own property-only tasks (document collection, a
-- photo shoot), which carry no contact, nor the tasks that name the
-- property's owner, nor those naming a contact with no buyer
-- association to the listing (a tenant, an advocate, a seller-side
-- broker): a buyer is a contact with a deal, a journey branch or an
-- enquiry on that property. Only the property path passes a null
-- contact; the deal and journey paths always name one.
--
-- This file sorts after every migration whose functions it replaces on
-- purpose: a replay by timestamp must land on these definitions last.
CREATE OR REPLACE FUNCTION public.is_property_buyer(
  p_account_id uuid, p_contact_id uuid, p_property_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_contact_id IS NOT NULL AND p_property_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM deals d
       WHERE d.account_id = p_account_id AND d.contact_id = p_contact_id AND d.property_id = p_property_id
    )
    OR EXISTS (
      SELECT 1 FROM journey_items ji
       WHERE ji.account_id = p_account_id AND ji.contact_id = p_contact_id AND ji.property_id = p_property_id
    )
    OR EXISTS (
      SELECT 1 FROM contact_property_inquiries i
       WHERE i.account_id = p_account_id AND i.contact_id = p_contact_id AND i.property_id = p_property_id
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_property_buyer(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_property_buyer(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_close_todos(
  p_account_id uuid, p_contact_id uuid, p_property_id uuid, p_note text
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  IF p_property_id IS NULL THEN RETURN 0; END IF;
  UPDATE todos
     SET completed = true,
         description = concat_ws(E'\n', NULLIF(description, ''), '[Auto-closed ' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || ': ' || p_note || ']')
   WHERE account_id = p_account_id
     AND NOT completed
     AND property_id = p_property_id
     AND (p_contact_id IS NULL OR contact_id = p_contact_id)
     AND (p_contact_id IS NOT NULL OR contact_id IS NOT NULL)
     AND (p_contact_id IS NOT NULL OR contact_id IS DISTINCT FROM (SELECT owner_contact_id FROM properties WHERE id = p_property_id AND account_id = p_account_id))
     AND (p_contact_id IS NOT NULL OR is_property_buyer(p_account_id, contact_id, p_property_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_close_stale_deal_todos(p_account_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE todos t
     SET completed = true,
         description = concat_ws(
           E'\n',
           NULLIF(t.description, ''),
           '[Auto-closed ' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || ': '
             || CASE
                  WHEN t.contact_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM properties p
                     WHERE p.id = t.property_id
                       AND p.account_id = t.account_id
                       AND p.status IN ('Sold', 'Off Market', 'Archived')
                       AND t.contact_id IS DISTINCT FROM p.owner_contact_id
                  ) AND is_property_buyer(t.account_id, t.contact_id, t.property_id)
                  THEN 'property no longer on the market'
                  WHEN EXISTS (
                    SELECT 1 FROM deals d
                     WHERE d.id = t.deal_id
                       AND d.account_id = t.account_id
                       AND d.status IN ('won', 'lost')
                  ) THEN 'deal closed'
                  ELSE 'journey dropped'
                END
             || ']'
         )
   WHERE t.account_id = p_account_id
     AND NOT t.completed
     AND (
       (
         t.contact_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM properties p
            WHERE p.id = t.property_id
              AND p.account_id = t.account_id
              AND p.status IN ('Sold', 'Off Market', 'Archived')
              AND t.contact_id IS DISTINCT FROM p.owner_contact_id
         )
         AND is_property_buyer(t.account_id, t.contact_id, t.property_id)
       )
       OR EXISTS (
         SELECT 1 FROM deals d
          WHERE d.id = t.deal_id
            AND d.account_id = t.account_id
            AND d.status IN ('won', 'lost')
       )
       OR (
         t.contact_id IS NOT NULL
         AND t.property_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM journey_items ji
            WHERE ji.account_id = t.account_id
              AND ji.contact_id = t.contact_id
              AND ji.property_id = t.property_id
              AND ji.status = 'dropped'
         )
         AND NOT EXISTS (
           SELECT 1 FROM journey_items ji
            WHERE ji.account_id = t.account_id
              AND ji.contact_id = t.contact_id
              AND ji.property_id = t.property_id
              AND ji.status <> 'dropped'
         )
       )
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- The listing status sender (src/lib/whatsapp/sold-notification.ts)
-- already tells every enquirer when a listing is Sold, minus those who
-- closed their enquiry, and runs from the listing status sync and the
-- property edit route. The trigger's own Sold notice duplicated it, and
-- reached the buyer whose won deal had just moved the listing to Sold.
-- A property leaving the market now only closes the follow-up todos.
CREATE OR REPLACE FUNCTION public.on_property_withdrawn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM auto_close_todos(new.account_id, NULL, new.id, 'property marked ' || new.status);
  RETURN new;
END;
$$;

UPDATE public.deal_status_notifications
   SET status = 'skipped',
       claimed_at = NULL,
       last_error = 'Sold updates are sent by the listing status sender'
 WHERE event = 'property_sold'
   AND status = 'pending';

-- A lost deal marked won fires, in order, deal_change_retire_notices
-- (retires the lost row), deal_closed_sync (queues the won row with the
-- branch's journey_item_id) and sync_journey_item_stage_from_deal, which
-- revives the branch; the revival must retire only the rows the drop
-- queued, or the won notice queued a moment earlier never goes out.
CREATE OR REPLACE FUNCTION public.retire_deal_status_notices_on_journey_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE deal_status_notifications
     SET status = 'skipped',
         claimed_at = NULL,
         last_error = 'Journey branch revived before the notice was sent'
   WHERE journey_item_id = new.id
     AND status = 'pending'
     AND event IN ('dropped', 'lost');
  RETURN new;
END;
$$;

-- A closed deal closes its own todos (by deal_id) and the buyer x
-- property follow-ups only when the deal names both; a deal without a
-- property, or one whose contact was deleted, must not widen the close
-- to every todo of that contact or every follow-up on that property.
-- Carries the note_added timeline entry from 20261014082622.
CREATE OR REPLACE FUNCTION public.on_deal_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  v_event text;
  v_note text;
BEGIN
  v_event := new.status;
  v_note := 'deal ' || v_event || coalesce(' — ' || new.lost_reason, '');

  UPDATE todos
     SET completed = true,
         description = concat_ws(E'\n', NULLIF(description, ''), '[Auto-closed ' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || ': ' || v_note || ']')
   WHERE account_id = new.account_id
     AND NOT completed
     AND deal_id = new.id;
  IF new.contact_id IS NOT NULL AND new.property_id IS NOT NULL THEN
    PERFORM auto_close_todos(new.account_id, new.contact_id, new.property_id, v_note);
  END IF;

  SELECT id, name, phone INTO c FROM contacts WHERE id = new.contact_id AND account_id = new.account_id;
  IF c.id IS NOT NULL THEN
    PERFORM queue_deal_status_notice(new.account_id, c.id, c.name, c.phone, 'buyer',
      new.property_id, new.id, new.source_journey_item_id, v_event, coalesce(new.lost_reason, new.lost_note));
  END IF;

  INSERT INTO deal_status_notifications
    (account_id, contact_id, recipient_name, recipient_phone, recipient_role, property_id, deal_id, event, internal_reason, message_text)
  SELECT s.account_id, s.contact_id, s.name, s.phone, s.role, new.property_id, new.id, v_event, coalesce(new.lost_reason, new.lost_note),
         CASE WHEN v_event = 'won'
              THEN format('Update on %s: the transaction has been concluded. Thank you for your support.', COALESCE((SELECT title FROM properties WHERE id = new.property_id AND account_id = new.account_id), 'the property'))
              ELSE format('Update on %s: this transaction will not be proceeding further. Thank you for your support.', COALESCE((SELECT title FROM properties WHERE id = new.property_id AND account_id = new.account_id), 'the property')) END
    FROM deal_stakeholders s
   WHERE s.deal_id = new.id AND s.account_id = new.account_id AND s.side = 'buyer'
     AND (s.contact_id IS NOT NULL OR s.phone IS NOT NULL)
     AND (s.contact_id IS NULL OR new.contact_id IS NULL OR s.contact_id <> new.contact_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO deal_events (account_id, deal_id, event_type, source, title, metadata, visibility)
  VALUES (new.account_id, new.id, 'note_added', 'system',
          'Follow-up tasks auto-closed',
          jsonb_build_object(
            'kind', 'tasks_auto_closed',
            'note', 'Follow-up tasks auto-closed; counterpart notices queued',
            'status', v_event,
            'reason', coalesce(new.lost_reason, new.lost_note)),
          'internal');
  RETURN new;
END;
$$;
