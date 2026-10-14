-- Additive. The pending-outcome index keys on property_id, and a
-- unique index treats two nulls as distinct, so a deal with no listing
-- let duplicate buyer-side stakeholder rows for one contact or phone
-- queue one notice each. This index keys the property as text with ''
-- for none, so a null takes part in the dedupe; the earlier index is
-- strictly weaker and stays in place, since the connector holds any
-- statement that would remove it. The pending duplicates it would
-- refuse are retired first.
UPDATE public.deal_status_notifications later
   SET status = 'skipped',
       claimed_at = NULL,
       last_error = 'Duplicate of an earlier pending notice for the same counterpart'
  FROM public.deal_status_notifications earlier
 WHERE later.status = 'pending'
   AND earlier.status = 'pending'
   AND earlier.account_id = later.account_id
   AND COALESCE(earlier.contact_id::text, earlier.recipient_phone)
       = COALESCE(later.contact_id::text, later.recipient_phone)
   AND earlier.property_id IS NOT DISTINCT FROM later.property_id
   AND (CASE WHEN earlier.event IN ('dropped', 'lost') THEN 'closed' ELSE earlier.event END)
       = (CASE WHEN later.event IN ('dropped', 'lost') THEN 'closed' ELSE later.event END)
   AND (earlier.created_at, earlier.id) < (later.created_at, later.id);

CREATE UNIQUE INDEX IF NOT EXISTS deal_status_notifications_pending_counterpart_dedupe
  ON public.deal_status_notifications (
    account_id,
    COALESCE(contact_id::text, recipient_phone),
    COALESCE(property_id::text, ''),
    (CASE WHEN event IN ('dropped', 'lost') THEN 'closed' ELSE event END)
  )
  WHERE status = 'pending';
