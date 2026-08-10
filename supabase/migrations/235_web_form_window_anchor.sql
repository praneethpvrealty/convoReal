-- ============================================================
-- 235_web_form_window_anchor.sql
-- Finish what 234 started, for the web-form intake routes.
--
-- 234 cleared `last_customer_message_at` on threads with no customer
-- message at all. The public intake routes (/api/public/inquiry,
-- requirements, document-request, location-request) file the form
-- submission as a `sender_type = 'customer'` message, so their threads
-- looked answered-by-the-contact and kept their anchor.
--
-- A web form is not an inbound WhatsApp message: it does not open
-- Meta's 24-hour free-form window. The routes no longer stamp the
-- anchor; this clears the rows where the only "customer" messages are
-- those synthetic ones.
-- ============================================================

UPDATE conversations c
SET last_customer_message_at = NULL
WHERE c.last_customer_message_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_type = 'customer'
      AND (
        m.message_id IS NULL
        OR m.message_id !~
          '^(web-inquiry|web-requirements|doc-request|location-request)-'
      )
  );
