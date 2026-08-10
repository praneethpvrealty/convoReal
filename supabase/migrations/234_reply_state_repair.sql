-- ============================================================
-- 234_reply_state_repair.sql
-- Repair the reply-queue columns migration 226 introduced.
--
-- Two writers broke the contract 226 documented:
--
--   * the portal lead webhook stamped `last_customer_message_at` when
--     a lead arrived by email, so the inbox anchored Meta's 24-hour
--     free-form window on a message the contact never sent;
--   * `sendAutoReply` sends outside `meta-api-dispatcher`, so the bot's
--     auto-reply never cleared `awaiting_reply` — threads the bot had
--     already answered sat in the queue as "Needs reply · 6h".
--
-- Both writers are fixed; this restores the rows they left behind.
-- ============================================================

-- The anchor means "the contact last wrote to us on WhatsApp". A
-- conversation with no inbound message has no anchor.
UPDATE conversations c
SET last_customer_message_at = NULL
WHERE c.last_customer_message_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_type = 'customer'
  );

-- Someone spoke after the contact did, so nobody is waiting on us.
-- Threads with no outbound message at all stay flagged: those are
-- leads whose auto-reply never went out, and they do need an answer.
UPDATE conversations c
SET awaiting_reply = false
WHERE c.awaiting_reply
  AND EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_type <> 'customer'
      AND (
        c.last_customer_message_at IS NULL
        OR m.created_at > c.last_customer_message_at
      )
  );

-- The preview froze at whatever wrote the row last, which for a portal
-- lead was the ingest line rather than the bot's reply.
UPDATE conversations c
SET last_message_text = lm.content_text,
    last_message_at = lm.created_at
FROM (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id, m.content_text, m.created_at
  FROM messages m
  ORDER BY m.conversation_id, m.created_at DESC
) lm
WHERE lm.conversation_id = c.id
  AND lm.content_text IS NOT NULL
  AND (c.last_message_at IS NULL OR lm.created_at > c.last_message_at);
