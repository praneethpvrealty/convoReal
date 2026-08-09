-- ============================================================
-- 227_conversation_dedupe_unique.sql
-- One 1:1 thread per contact, enforced by the database.
--
-- `conversations` never had a uniqueness rule for the 1:1 case —
-- migration 222 added one for `group_id` and stopped there. Every
-- creator therefore ran an unguarded read-then-insert, and two
-- overlapping broadcast sweeps (POST /api/broadcasts fires a
-- fire-and-forget send, and both /api/cron/broadcast-sweep and
-- /api/automations/cron call sweepAndSendBroadcasts) produced pairs
-- of conversations for the same contact milliseconds apart.
--
-- The duplication then compounded on its own: the resolvers read with
-- `.single()` / `.maybeSingle()` and no `.limit(1)`, so once two rows
-- existed PostgREST answered PGRST116 ("more than one row"), the
-- callers read that error as "none found", and every subsequent
-- message opened yet another thread. One contact reached five.
--
-- This migration folds the duplicates into the oldest row of each
-- group and adds the constraint that makes the class of bug
-- impossible. Group threads carry `contact_id IS NULL`, and Postgres
-- treats NULLs as distinct in a unique constraint, so they are
-- unaffected.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Fold every duplicate 1:1 thread into the oldest row of its
--    (account_id, contact_id) group.
-- ------------------------------------------------------------
-- A real table, not a TEMP one: migration runners do not all keep a
-- single session across statements, and a temp table that vanishes
-- mid-migration would silently merge nothing. Dropped at the end.
DROP TABLE IF EXISTS conversation_merge_map_227;
CREATE TABLE conversation_merge_map_227 AS
SELECT
  c.id AS duplicate_id,
  first_value(c.id) OVER grp AS survivor_id
FROM conversations c
WHERE c.contact_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM conversations d
    WHERE d.account_id = c.account_id
      AND d.contact_id = c.contact_id
      AND d.id <> c.id
  )
WINDOW grp AS (
  PARTITION BY c.account_id, c.contact_id
  ORDER BY c.created_at, c.id
);

DELETE FROM conversation_merge_map_227 WHERE duplicate_id = survivor_id;

-- Children that must follow the surviving thread. `messages` and
-- `message_reactions` cascade on delete, so they have to move before
-- the surplus rows go; the nullable FKs would survive the delete but
-- would point at nothing.
UPDATE messages m
SET conversation_id = mm.survivor_id
FROM conversation_merge_map_227 mm
WHERE m.conversation_id = mm.duplicate_id;

UPDATE message_reactions r
SET conversation_id = mm.survivor_id
FROM conversation_merge_map_227 mm
WHERE r.conversation_id = mm.duplicate_id;

UPDATE deals d
SET conversation_id = mm.survivor_id
FROM conversation_merge_map_227 mm
WHERE d.conversation_id = mm.duplicate_id;

UPDATE flow_runs f
SET conversation_id = mm.survivor_id
FROM conversation_merge_map_227 mm
WHERE f.conversation_id = mm.duplicate_id;

UPDATE ctwa_referrals t
SET conversation_id = mm.survivor_id
FROM conversation_merge_map_227 mm
WHERE t.conversation_id = mm.duplicate_id;

UPDATE learned_facts l
SET conversation_id = mm.survivor_id
FROM conversation_merge_map_227 mm
WHERE l.conversation_id = mm.duplicate_id;

UPDATE whatsapp_reply_bridges b
SET target_conversation_id = mm.survivor_id
FROM conversation_merge_map_227 mm
WHERE b.target_conversation_id = mm.duplicate_id;

-- ------------------------------------------------------------
-- 2. Carry the merged group's state onto the survivor.
--
--    Manual state resolves toward "still needs attention": a thread
--    is closed or archived only when every copy was, because the
--    copy a customer was actively writing into is the one that
--    matters. Everything message-derived is recomputed from the
--    messages now hanging off the survivor rather than summed from
--    the rows, so the result matches what the inbox will render.
-- ------------------------------------------------------------
WITH groups AS (
  SELECT
    mm.survivor_id,
    bool_and(c.status = 'closed') AS all_closed,
    bool_or(c.status = 'open') AS any_open,
    bool_and(c.is_archived) AS all_archived,
    sum(COALESCE(c.unread_count, 0)) AS unread_total,
    -- Oldest non-null assignment across the group; the survivor's own
    -- wins because it sorts first on created_at.
    (array_remove(array_agg(c.assigned_agent_id ORDER BY c.created_at, c.id), NULL))[1]
      AS assigned_agent_id
  FROM conversations c
  JOIN (
    SELECT survivor_id, duplicate_id FROM conversation_merge_map_227
    UNION ALL
    SELECT DISTINCT survivor_id, survivor_id FROM conversation_merge_map_227
  ) mm ON c.id = mm.duplicate_id
  GROUP BY mm.survivor_id
),
last_msg AS (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id,
    m.created_at,
    m.content_text,
    m.sender_type
  FROM messages m
  WHERE m.conversation_id IN (SELECT survivor_id FROM groups)
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
),
last_customer AS (
  SELECT m.conversation_id, max(m.created_at) AS at
  FROM messages m
  WHERE m.conversation_id IN (SELECT survivor_id FROM groups)
    AND m.sender_type = 'customer'
  GROUP BY m.conversation_id
)
UPDATE conversations c
SET
  status = CASE
    WHEN g.all_closed THEN 'closed'
    WHEN g.any_open THEN 'open'
    ELSE 'pending'
  END,
  is_archived = g.all_archived,
  unread_count = g.unread_total,
  assigned_agent_id = g.assigned_agent_id,
  last_message_at = COALESCE(lm.created_at, c.last_message_at),
  last_message_text = COALESCE(lm.content_text, c.last_message_text),
  last_customer_message_at = lc.at,
  awaiting_reply = (
    lm.sender_type = 'customer'
    AND NOT g.all_closed
    AND NOT g.all_archived
  ),
  updated_at = NOW()
FROM groups g
LEFT JOIN last_msg lm ON lm.conversation_id = g.survivor_id
LEFT JOIN last_customer lc ON lc.conversation_id = g.survivor_id
WHERE c.id = g.survivor_id;

-- ------------------------------------------------------------
-- 3. Drop the emptied duplicates.
-- ------------------------------------------------------------
DELETE FROM conversations c
USING conversation_merge_map_227 mm
WHERE c.id = mm.duplicate_id;

DROP TABLE conversation_merge_map_227;

-- ------------------------------------------------------------
-- 4. Make it impossible to reintroduce.
--
--    A constraint rather than a bare unique index: the resolvers
--    detect the 23505 and re-read the winning row, which is the
--    behaviour a lost race should have had all along.
-- ------------------------------------------------------------
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_account_contact_unique;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_account_contact_unique
  UNIQUE (account_id, contact_id);

COMMENT ON CONSTRAINT conversations_account_contact_unique ON conversations IS
  'One 1:1 thread per contact per account. Group threads carry contact_id IS NULL and are exempt because Postgres treats NULLs as distinct here.';
