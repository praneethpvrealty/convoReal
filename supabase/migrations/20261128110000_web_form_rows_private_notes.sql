UPDATE messages
SET sender_type = 'bot',
    private = true
WHERE sender_type = 'customer'
  AND message_id ~ '^(web-inquiry|ai-agent-inquiry|web-requirements|doc-request|location-request)-';
