-- ============================================================
-- 228_broadcast_dispatch_lease.sql
-- Stops two dispatchers sending the same broadcast twice.
--
-- sendBroadcastRecipients() selects recipients still 'pending', sends
-- to each, then marks it sent. Nothing claims a row between the read
-- and the send, so two concurrent runners read the same pending set and
-- both send. That was harmless while the only runner was the
-- fire-and-forget promise POST /api/broadcasts starts — but the
-- broadcast-sweep cron (migration-less, added in #388) is a second
-- runner, and it fires every 5 minutes into a dispatch that paces at
-- one send per second. A 50-recipient batch takes ~50s, so the overlap
-- is routine rather than rare: one real batch went out 100% duplicated,
-- the next 32%.
--
-- Rather than claim each recipient row — which leaves rows stranded in
-- a non-terminal state when a serverless function is reclaimed
-- mid-flight, and those rows are exactly what the sweep exists to
-- rescue — the lease is taken on the broadcast. One dispatcher holds
-- it at a time; recipients stay 'pending' throughout, so a dispatcher
-- that dies loses the lease on expiry and the next sweep resumes its
-- work with nothing lost.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS dispatch_lease_until TIMESTAMPTZ;

COMMENT ON COLUMN broadcasts.dispatch_lease_until IS
  'While in the future, a dispatcher is actively sending this broadcast and no other may start. Expires so a crashed dispatcher does not strand the batch.';

-- Claims the broadcast for one dispatcher, or returns nothing when
-- another already holds it. The WHERE clause is the mutex: Postgres
-- serialises the conditional UPDATE, so exactly one concurrent caller
-- can observe a free lease and take it.
CREATE OR REPLACE FUNCTION public.claim_broadcast_dispatch(
  p_broadcast_id UUID,
  p_lease_seconds INT DEFAULT 120
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed UUID;
BEGIN
  UPDATE broadcasts
     SET dispatch_lease_until = NOW() + make_interval(secs => p_lease_seconds)
   WHERE id = p_broadcast_id
     AND status = 'sending'
     AND (dispatch_lease_until IS NULL OR dispatch_lease_until < NOW())
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.claim_broadcast_dispatch(UUID, INT) IS
  'True when this caller now holds the dispatch lease for the broadcast; false when another dispatcher holds it and this caller must not send.';

-- Extends a lease already held, so a long batch is not overtaken
-- mid-flight by a sweep that assumed the holder had died.
CREATE OR REPLACE FUNCTION public.renew_broadcast_dispatch(
  p_broadcast_id UUID,
  p_lease_seconds INT DEFAULT 120
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE broadcasts
     SET dispatch_lease_until = NOW() + make_interval(secs => p_lease_seconds)
   WHERE id = p_broadcast_id;
$$;

-- Frees the lease the moment a dispatcher finishes, so a retry sweep
-- picks up leftovers immediately instead of waiting out the expiry.
CREATE OR REPLACE FUNCTION public.release_broadcast_dispatch(
  p_broadcast_id UUID
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE broadcasts SET dispatch_lease_until = NULL WHERE id = p_broadcast_id;
$$;

REVOKE ALL ON FUNCTION public.claim_broadcast_dispatch(UUID, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renew_broadcast_dispatch(UUID, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_broadcast_dispatch(UUID) FROM PUBLIC, anon;
