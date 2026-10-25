DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    WITH RECURSIVE chain AS (
      SELECT c.account_id, c.id AS alias_id, c.phone AS alias_phone,
             c.merged_into_id AS next_id, 1 AS depth
      FROM contacts c
      WHERE c.is_merged AND c.merged_into_id IS NOT NULL
      UNION ALL
      SELECT ch.account_id, ch.alias_id, ch.alias_phone,
             w.merged_into_id, ch.depth + 1
      FROM chain ch
      JOIN contacts w ON w.id = ch.next_id AND w.account_id = ch.account_id
      WHERE w.is_merged AND w.merged_into_id IS NOT NULL AND ch.depth < 5
    )
    SELECT ch.account_id, ch.alias_id, w.id AS winner_id
    FROM chain ch
    JOIN contacts w
      ON w.id = ch.next_id
     AND w.account_id = ch.account_id
     AND NOT w.is_merged
    WHERE length(regexp_replace(coalesce(ch.alias_phone, ''), '\D', '', 'g')) >= 7
      AND right(regexp_replace(ch.alias_phone, '\D', '', 'g'), 10)
        = right(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), 10)
      AND EXISTS (
        SELECT 1 FROM conversations cv
        WHERE cv.account_id = ch.account_id AND cv.contact_id = ch.alias_id
      )
    ORDER BY ch.depth DESC
  LOOP
    PERFORM merge_contact_conversations(r.account_id, r.alias_id, r.winner_id);
  END LOOP;
END $$;
