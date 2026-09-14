CREATE TABLE IF NOT EXISTS public.buyer_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, property_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_alert_deliveries_due
  ON public.buyer_alert_deliveries (due_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_buyer_alert_deliveries_account
  ON public.buyer_alert_deliveries (account_id, created_at DESC);

ALTER TABLE public.buyer_alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.buyer_alert_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.buyer_alert_deliveries TO service_role;

DROP TRIGGER IF EXISTS set_buyer_alert_deliveries_updated_at
  ON public.buyer_alert_deliveries;
CREATE TRIGGER set_buyer_alert_deliveries_updated_at
  BEFORE UPDATE ON public.buyer_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.buyer_alert_deliveries IS
  'Service-role queue for consented, deduplicated buyer WhatsApp alerts when a matching listing becomes available.';
