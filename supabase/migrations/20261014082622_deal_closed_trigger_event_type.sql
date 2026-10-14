-- Hotfix for 20261014023548, applied to production on 14 Oct 2026 as soon
-- as the fault was found: on_deal_closed inserted a deal_events row with
-- event_type 'tasks_auto_closed', which deal_events_event_type_check does
-- not allow, so every UPDATE of deals.status to won or lost failed and
-- rolled back. The constraint cannot be widened without a DROP, so the
-- timeline entry is a system note instead; the timeline already renders
-- metadata.note for note_added, and metadata.kind keeps the marker.
CREATE OR REPLACE FUNCTION public.on_deal_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  v_event text;
BEGIN
  v_event := new.status;
  PERFORM auto_close_todos(new.account_id, new.contact_id, new.property_id,
    'deal ' || v_event || coalesce(' — ' || new.lost_reason, ''));

  SELECT id, name, phone INTO c FROM contacts WHERE id = new.contact_id;
  PERFORM queue_deal_status_notice(new.account_id, c.id, c.name, c.phone, 'buyer',
    new.property_id, new.id, new.source_journey_item_id, v_event, coalesce(new.lost_reason, new.lost_note));

  INSERT INTO deal_status_notifications
    (account_id, contact_id, recipient_name, recipient_phone, recipient_role, property_id, deal_id, event, internal_reason, message_text)
  SELECT s.account_id, s.contact_id, s.name, s.phone, s.role, new.property_id, new.id, v_event, coalesce(new.lost_reason, new.lost_note),
         CASE WHEN v_event = 'won'
              THEN format('Update on %s: the transaction has been concluded. Thank you for your support.', (SELECT title FROM properties WHERE id = new.property_id))
              ELSE format('Update on %s: this transaction will not be proceeding further. Thank you for your support.', (SELECT title FROM properties WHERE id = new.property_id)) END
    FROM deal_stakeholders s
   WHERE s.deal_id = new.id AND s.side = 'buyer' AND s.phone IS NOT NULL
     AND (s.contact_id IS NULL OR s.contact_id <> new.contact_id)
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
