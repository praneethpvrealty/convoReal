DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.account_id, c.id AS alias_id, c.merged_into_id AS winner_id
    FROM contacts c
    JOIN contacts w
      ON w.id = c.merged_into_id
     AND w.account_id = c.account_id
     AND NOT w.is_merged
    WHERE c.is_merged
      AND length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 7
      AND right(regexp_replace(c.phone, '\D', '', 'g'), 10)
        = right(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), 10)
      AND EXISTS (
        SELECT 1 FROM conversations cv
        WHERE cv.account_id = c.account_id AND cv.contact_id = c.id
      )
  LOOP
    PERFORM merge_contact_conversations(r.account_id, r.alias_id, r.winner_id);
  END LOOP;
END $$;
