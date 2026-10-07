-- ============================================================
-- 20261004140649_match_event_send_claim.sql
--
-- POST /api/radar/send delivers a Match Radar event's alerts one
-- target at a time and used to record the event as sent only once the
-- whole batch finished. A send that outlived the client's request (a
-- timeout, a reload, an app restart) left the card at status 'new', so
-- it could be submitted again and every recipient got the alert twice.
--
-- send_claimed_at is the server-side claim: the route sets it with one
-- conditional UPDATE before sending and refuses a second send while it
-- is younger than the route's time limit plus a margin. sent_target_ids
-- records each target as its alert is delivered, so any later send of
-- the event (a resubmit from a stale screen, or a retry after the
-- function was killed mid-batch) skips the recipients who already have
-- it.
--
-- Purely additive: two nullable columns, no default, no backfill. RLS
-- is unchanged.
-- ============================================================

ALTER TABLE match_events
  ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_target_ids TEXT[];
