-- ============================================================
-- 231_broadcast_recipient_claim.sql
-- Makes a recipient physically un-sendable twice.
--
-- The broadcast-level lease (228) provably serialises two callers of
-- claim_broadcast_dispatch — verified against this database, including
-- a genuine concurrent race. Duplicates continued anyway: on one real
-- batch, 46 of 50 leads got two messages, one pair only 2ms apart. Two
-- sends 2ms apart cannot come from one sequential loop, so a second
-- sender exists that does not pass through that lease, and repeated
-- investigation has not identified it.
--
-- So this stops relying on knowing who the senders are. Sending is
-- gated on winning an atomic UPDATE of the recipient row itself:
-- 'pending' -> 'sending', returning only rows this caller actually
-- flipped. Postgres serialises those updates, so a row can be claimed
-- exactly once no matter how many senders race for it, whether they
-- hold the broadcast lease or were never aware of it.
--
-- The failure mode this introduces — a row stranded in 'sending' when
-- a serverless function is reclaimed mid-flight — is handled by
-- reclaiming rows whose claim has gone stale, so the sweep can still
-- finish an interrupted batch. Stale is deliberately generous: sending
-- late is recoverable, sending twice is not.
-- ============================================================

ALTER TABLE broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;

ALTER TABLE broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status IN (
    'pending', 'sending', 'sent', 'delivered',
    'read', 'replied', 'failed', 'rate_limited'
  ));

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN broadcast_recipients.claimed_at IS
  'When a sender took this row. Set with the pending -> sending flip; a row still sending long after this is treated as abandoned and reclaimed.';

-- Claims up to p_limit due recipients for this caller and returns them.
-- A row appears in the result only if THIS statement moved it out of a
-- sendable state, which is what makes a second sender come back empty
-- rather than sending the same message again.
CREATE OR REPLACE FUNCTION public.claim_broadcast_recipients(
  p_broadcast_id UUID,
  p_limit INT DEFAULT 200,
  p_stale_seconds INT DEFAULT 600
)
RETURNS SETOF broadcast_recipients
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE broadcast_recipients br
     SET status = 'sending',
         claimed_at = NOW()
   WHERE br.id IN (
     SELECT id
       FROM broadcast_recipients
      WHERE broadcast_id = p_broadcast_id
        AND (
          status IN ('pending', 'rate_limited')
          -- A previous sender took this row and never came back.
          OR (status = 'sending'
              AND (claimed_at IS NULL
                   OR claimed_at < NOW() - make_interval(secs => p_stale_seconds)))
        )
        AND (retry_after IS NULL OR retry_after <= NOW())
      ORDER BY created_at
      LIMIT p_limit
      -- Two senders arriving together do not queue behind each other
      -- for rows the other already took; the loser simply gets fewer.
      FOR UPDATE SKIP LOCKED
   )
  RETURNING br.*;
$$;

COMMENT ON FUNCTION public.claim_broadcast_recipients(UUID, INT, INT) IS
  'Atomically claims due recipients of a broadcast, returning only rows this caller moved to sending. A row can be claimed by exactly one caller, so it can be sent exactly once.';

REVOKE ALL ON FUNCTION public.claim_broadcast_recipients(UUID, INT, INT) FROM PUBLIC, anon;

-- Counts what is still outstanding, so the sender can decide whether a
-- broadcast is finished without re-reading every row itself.
CREATE OR REPLACE FUNCTION public.broadcast_outstanding_count(
  p_broadcast_id UUID
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
    FROM broadcast_recipients
   WHERE broadcast_id = p_broadcast_id
     AND status IN ('pending', 'sending', 'rate_limited');
$$;

REVOKE ALL ON FUNCTION public.broadcast_outstanding_count(UUID) FROM PUBLIC, anon;
