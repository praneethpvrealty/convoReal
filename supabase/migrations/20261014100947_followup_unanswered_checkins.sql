-- ============================================================
-- 20261014100947_followup_unanswered_checkins.sql — how many check-in
-- templates each lead has been sent since they last wrote.
--
-- The follow-up radar re-carded a silent HOT lead every week for as long
-- as they stayed silent, and every Check in tap sent the same
-- enquiry_checkin_notice again: five and six identical check-ins over two
-- months reached leads who never once answered. The radar reads this
-- count and stops carding a lead once it reaches its cap.
--
-- Additive: a new function only. Service role only, like the radar's
-- other functions; the cron passes the account and its own contact ids.
-- ============================================================

CREATE OR REPLACE FUNCTION public.followup_unanswered_checkins(
  p_account_id uuid,
  p_contact_ids uuid[],
  p_template_names text[]
)
RETURNS TABLE (contact_id uuid, unanswered integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT cv.contact_id, count(m.id)::integer AS unanswered
  FROM conversations cv
  JOIN messages m
    ON m.conversation_id = cv.id
   AND m.account_id = p_account_id
  WHERE cv.account_id = p_account_id
    AND cv.contact_id = ANY (p_contact_ids)
    AND m.template_name = ANY (p_template_names)
    AND m.sender_type <> 'customer'
    AND m.status IS DISTINCT FROM 'failed'
    AND m.created_at > COALESCE(
      (
        SELECT max(c.created_at)
        FROM messages c
        WHERE c.account_id = p_account_id
          AND c.conversation_id = cv.id
          AND c.sender_type = 'customer'
      ),
      '-infinity'::timestamptz
    )
  GROUP BY cv.contact_id;
$$;

REVOKE ALL ON FUNCTION public.followup_unanswered_checkins(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.followup_unanswered_checkins(uuid, uuid[], text[]) TO service_role;
