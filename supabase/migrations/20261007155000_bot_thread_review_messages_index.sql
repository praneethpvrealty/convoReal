-- bot_thread_review_candidates aggregates the newest delivered bot
-- message per conversation across every account, a predicate no
-- account-led index serves. A partial index over exactly those rows,
-- led by time, keeps that scan an index-only range read.

CREATE INDEX IF NOT EXISTS idx_messages_bot_visible_created
  ON messages (created_at, conversation_id)
  WHERE sender_type = 'bot' AND private = false AND status IS DISTINCT FROM 'failed';
