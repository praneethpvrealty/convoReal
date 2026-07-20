-- The account owner texting their own CRM number (the WhatsApp lister
-- self-chat) is not a lead. The webhook now keeps those threads
-- archived and unread-free as messages arrive (webhook-handler.ts);
-- this backfills the existing ones out of the shared inbox. Matching
-- mirrors phonesMatch(): digits-only, last-8-digit comparison.

UPDATE conversations c
SET is_archived = TRUE,
    unread_count = 0,
    updated_at = NOW()
FROM contacts ct,
     profiles p
WHERE ct.id = c.contact_id
  AND ct.account_id = c.account_id
  AND p.account_id = c.account_id
  AND p.account_role = 'owner'
  AND p.phone IS NOT NULL
  AND length(regexp_replace(p.phone, '\D', '', 'g')) >= 8
  AND length(regexp_replace(ct.phone, '\D', '', 'g')) >= 8
  AND right(regexp_replace(ct.phone, '\D', '', 'g'), 8) =
      right(regexp_replace(p.phone, '\D', '', 'g'), 8)
  AND (c.is_archived = FALSE OR c.unread_count > 0);
