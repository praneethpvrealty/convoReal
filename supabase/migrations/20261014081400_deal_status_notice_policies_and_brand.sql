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
-- and an account with no name set thanks the buyer without one.
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
  SELECT title, owner_contact_id INTO v_prop_title, v_owner FROM properties WHERE id = p_property_id;
  IF p_contact_id IS NOT NULL AND v_owner IS NOT NULL AND p_contact_id = v_owner THEN RETURN; END IF;
  IF p_phone IS NULL OR p_phone = '' THEN RETURN; END IF;

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
-- one opened from this journey branch is the one the drop closes. Prefer
-- the deal linked by source_journey_item_id over the pair's latest.
CREATE OR REPLACE FUNCTION public.on_journey_item_dropped() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  d record;
BEGIN
  PERFORM auto_close_todos(new.account_id, new.contact_id, new.property_id,
    'journey dropped' || coalesce(' — ' || new.drop_reason, ''));

  SELECT id, name, phone INTO c FROM contacts WHERE id = new.contact_id;
  SELECT id, status INTO d
    FROM deals
   WHERE account_id = new.account_id
     AND (source_journey_item_id = new.id
          OR (contact_id = new.contact_id AND property_id = new.property_id))
   ORDER BY (source_journey_item_id = new.id) DESC NULLS LAST, updated_at DESC
   LIMIT 1;

  PERFORM queue_deal_status_notice(new.account_id, c.id, c.name, c.phone, 'buyer',
    new.property_id, d.id, new.id, CASE WHEN d.status = 'lost' THEN 'lost' ELSE 'dropped' END, new.drop_reason);

  IF d.id IS NOT NULL THEN
    INSERT INTO deal_status_notifications
      (account_id, contact_id, recipient_name, recipient_phone, recipient_role, property_id, deal_id, journey_item_id, event, internal_reason, message_text)
    SELECT s.account_id, s.contact_id, s.name, s.phone, s.role, new.property_id, d.id, new.id, 'lost', new.drop_reason,
           format('Update on %s: this transaction will not be proceeding further. Thank you for your support.', (SELECT title FROM properties WHERE id = new.property_id))
      FROM deal_stakeholders s
     WHERE s.deal_id = d.id AND s.side = 'buyer' AND s.phone IS NOT NULL
       AND (s.contact_id IS NULL OR s.contact_id <> new.contact_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN new;
END;
$$;
