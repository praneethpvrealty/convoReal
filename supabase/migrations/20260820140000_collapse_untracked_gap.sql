-- ============================================================
-- 20260820140000_collapse_untracked_gap.sql
--
-- `no_deal` + `missing_next_step` → `untracked_conversation`.
--
-- They were never two questions. One asked whether a live conversation
-- was on a pipeline, the other whether anything was scheduled on it,
-- and on the sweep's first production run they fired on the same four
-- contacts and produced eight of the ten gaps between them. A reviewer
-- reading the second card about a contact learns nothing the first did
-- not already say — which is how a review queue stops being opened.
--
-- Order matters here and the migration will fail loudly if it is
-- changed. `idx_conversation_gaps_open_key` is UNIQUE on
-- (account_id, dedupe_key) WHERE status = 'open', and the dedupe key is
-- built from the kind. The moment two open rows for one contact both
-- become 'untracked_conversation' they collide, so the duplicates have
-- to be stood down BEFORE the survivors are renamed.
-- ============================================================

-- ── 1. Stand down the duplicates ─────────────────────────────
-- Per (account, subject), keep the row a reader would have acted on
-- first — highest severity, then most recent — and dismiss the rest.
-- Dismissed rather than deleted: these rows are the evidence that the
-- two detectors overlapped, which is the reason for this migration.
-- `resolved_by` stays NULL because no person decided this.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        account_id,
        COALESCE(conversation_id::text, contact_id::text, id::text)
      ORDER BY
        CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        occurred_at DESC
    ) AS rank
  FROM conversation_gaps
  WHERE status = 'open'
    AND kind IN ('no_deal', 'missing_next_step')
)
UPDATE conversation_gaps g
SET status = 'dismissed',
    resolved_at = NOW()
FROM ranked r
WHERE g.id = r.id AND r.rank > 1;

-- ── 2. Rename the survivors ──────────────────────────────────
-- The dedupe key has to move with the kind, or tomorrow's sweep builds
-- 'untracked_conversation:<subject>', matches nothing, and opens a
-- second row for a gap that is already sitting there.
UPDATE conversation_gaps
SET kind = 'untracked_conversation',
    dedupe_key = 'untracked_conversation:' ||
      split_part(dedupe_key, ':', 2)
WHERE kind IN ('no_deal', 'missing_next_step');

-- ── 3. Swap the constraint ───────────────────────────────────
ALTER TABLE conversation_gaps DROP CONSTRAINT IF EXISTS conversation_gaps_kind_check;
ALTER TABLE conversation_gaps ADD CONSTRAINT conversation_gaps_kind_check
  CHECK (kind IN (
    'unanswered_question',
    'unkept_promise',
    'untracked_conversation',
    'bot_handoff',
    'unmatched_requirement'
  ));
