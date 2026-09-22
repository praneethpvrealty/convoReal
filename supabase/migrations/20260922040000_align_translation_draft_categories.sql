-- Meta fixes a template name's category the first time any language of
-- it passes review, and refuses a later language under a different
-- category. Local drafts of the other product languages were created
-- with the Engine builder's request (Utility) even where Meta had
-- already approved the English variant as Marketing, so the badge the
-- reviewer read promised a category the submission could never get.
-- Align every not-yet-submitted draft with the category Meta holds for
-- its name in the same account. The review-reset trigger (248) only
-- watches the wording, so a reviewer's sign-off survives this.
UPDATE message_templates AS draft
SET category = held.category
FROM (
  SELECT DISTINCT ON (account_id, name)
    account_id,
    name,
    category
  FROM message_templates
  WHERE meta_template_id IS NOT NULL
    AND category IS NOT NULL
  ORDER BY account_id, name, (status = 'APPROVED') DESC, last_submitted_at DESC NULLS LAST
) AS held
WHERE draft.account_id = held.account_id
  AND draft.name = held.name
  AND draft.meta_template_id IS NULL
  AND draft.category IS DISTINCT FROM held.category;
