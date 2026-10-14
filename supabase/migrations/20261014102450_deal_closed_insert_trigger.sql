-- Additive. The new-deal form can open a deal straight into a won or
-- lost stage, and POST /api/deals inserts that closed status directly,
-- so the AFTER UPDATE trigger never saw it: no todos closed, no notice,
-- no timeline note. on_deal_closed reads only NEW, so the same function
-- serves an insert that lands closed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'deal_closed_on_insert_sync_trigger'
       AND tgrelid = 'public.deals'::regclass
  ) THEN
    CREATE TRIGGER deal_closed_on_insert_sync_trigger
      AFTER INSERT ON public.deals
      FOR EACH ROW WHEN (new.status IN ('won', 'lost'))
      EXECUTE FUNCTION public.on_deal_closed();
  END IF;
END;
$$;
