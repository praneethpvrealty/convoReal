-- Additive: the queue table was created without the updated_at column
-- and set_updated_at trigger every operational table carries (§7.2), so
-- a claim, an attempt, a skip or a send left no trace of when the row
-- last changed. The trigger is created only when it is missing so the
-- file can be re-run as it is.
ALTER TABLE public.deal_status_notifications
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'set_deal_status_notifications_updated_at'
       AND tgrelid = 'public.deal_status_notifications'::regclass
  ) THEN
    CREATE TRIGGER set_deal_status_notifications_updated_at
      BEFORE UPDATE ON public.deal_status_notifications
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;
