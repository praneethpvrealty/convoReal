-- A bot thread review is claimed (inserted with the rule verdict) before
-- the model judge runs and finalised once it has answered. judged_at
-- marks the finalised row; a claim it never reaches belongs to a run
-- that died mid-judge, and bot_thread_review_candidates lets the next
-- run take it over instead of treating it as the thread's last review.

ALTER TABLE bot_thread_reviews ADD COLUMN IF NOT EXISTS judged_at TIMESTAMPTZ;
