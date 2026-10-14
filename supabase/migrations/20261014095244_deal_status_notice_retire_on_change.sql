-- Additive. A deal marked lost or won and then reopened or corrected
-- before the cron drained the queue kept its first notice pending, so
-- the buyer could later be told a reopened transaction "will not be
-- proceeding", or get a lost notice and a won notice for one deal. The
-- pending rows of a deal are retired whenever it leaves a closed status
-- (the trigger name sorts before deal_closed_sync_trigger so a lost deal
-- marked won retires the lost row before the won row is queued), and a
-- revived journey branch retires the rows its drop queued.
CREATE OR REPLACE FUNCTION public.retire_deal_status_notices_on_deal_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE deal_status_notifications
     SET status = 'skipped',
         claimed_at = NULL,
         last_error = 'Deal status changed before the notice was sent'
   WHERE deal_id = new.id
     AND status = 'pending';
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_deal_status_notices_on_journey_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE deal_status_notifications
     SET status = 'skipped',
         claimed_at = NULL,
         last_error = 'Journey branch revived before the notice was sent'
   WHERE journey_item_id = new.id
     AND status = 'pending';
  RETURN new;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'deal_change_retire_notices_trigger'
       AND tgrelid = 'public.deals'::regclass
  ) THEN
    CREATE TRIGGER deal_change_retire_notices_trigger
      AFTER UPDATE OF status ON public.deals
      FOR EACH ROW WHEN (old.status IN ('won', 'lost') AND new.status IS DISTINCT FROM old.status)
      EXECUTE FUNCTION public.retire_deal_status_notices_on_deal_change();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'journey_change_retire_notices_trigger'
       AND tgrelid = 'public.journey_items'::regclass
  ) THEN
    CREATE TRIGGER journey_change_retire_notices_trigger
      AFTER UPDATE OF status ON public.journey_items
      FOR EACH ROW WHEN (old.status = 'dropped' AND new.status IS DISTINCT FROM 'dropped')
      EXECUTE FUNCTION public.retire_deal_status_notices_on_journey_change();
  END IF;
END;
$$;
