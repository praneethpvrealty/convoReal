-- Additive follow-up to 20261014023548.
--
-- A journey drop fires journey_item_dropped_sync_trigger before the
-- deal<->journey sync marks the deal lost, so the buyer was queued one
-- 'dropped' notice and then one 'lost' notice for the same outcome. The
-- original dedupe index keys on the event name and on contact_id, which
-- is null for a stakeholder, so neither duplicate was caught. This index
-- treats dropped and lost as one outcome and keys phone-only recipients
-- by phone.
CREATE UNIQUE INDEX IF NOT EXISTS deal_status_notifications_pending_outcome_dedupe
  ON public.deal_status_notifications (
    account_id,
    COALESCE(contact_id::text, recipient_phone),
    property_id,
    (CASE WHEN event IN ('dropped', 'lost') THEN 'closed' ELSE event END)
  )
  WHERE status = 'pending';

-- The definer functions were created with the default EXECUTE grant to
-- PUBLIC, so any signed-in user could close another account's todos or
-- queue a notice against it through PostgREST. Only the triggers and the
-- service role call them.
REVOKE EXECUTE ON FUNCTION public.auto_close_todos(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.queue_deal_status_notice(UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_close_todos(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_deal_status_notice(UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT) TO service_role;

-- The backup the triggers cannot give: an open todo whose deal closed,
-- whose journey branch dropped or whose property left the market before
-- the triggers existed, or through a path that changed the row without
-- an UPDATE of status. The drain cron runs this for every connected
-- account before the morning digest reads todos.
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
                  WHEN EXISTS (
                    SELECT 1 FROM properties p
                     WHERE p.id = t.property_id
                       AND p.account_id = t.account_id
                       AND p.status IN ('Sold', 'Off Market', 'Archived')
                  ) THEN 'property no longer on the market'
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
       EXISTS (
         SELECT 1 FROM properties p
          WHERE p.id = t.property_id
            AND p.account_id = t.account_id
            AND p.status IN ('Sold', 'Off Market', 'Archived')
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

REVOKE EXECUTE ON FUNCTION public.auto_close_stale_deal_todos(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_close_stale_deal_todos(UUID) TO service_role;

COMMENT ON FUNCTION public.auto_close_stale_deal_todos(UUID) IS
  'Service-role sweep: completes open todos whose property left the market, whose deal closed, or whose only journey branch for that contact and property dropped. Backup for the status triggers.';
