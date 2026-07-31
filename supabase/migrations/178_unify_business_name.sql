-- One brokerage, one name.
--
-- The brand was stored twice: accounts.name (appointment reminders,
-- invitations, Den bids, YouTube uploads, listing-video branding) and
-- showcase_settings.website_name (the public showcase, /property,
-- /projects, /list, the AI chatbot's businessName, WhatsApp flows'
-- business_name). Nothing kept them in step, so the same client could be
-- greeted by two different brands — one account here reads "Aryavarta
-- Realty" on reminders and "Aryavarta Ventures" on its showcase.
--
-- accounts.name wins: it is NOT NULL, exists for every account, and
-- already has an owner in the API (PATCH /api/account, admin-gated).
-- website_name is the better *value* though — it is the name someone
-- deliberately typed for public display, where accounts.name is often a
-- signup artifact ("praneeth Account") — so it is copied over first.
--
-- website_url goes too: it was written by the settings form and read by
-- nothing. Every URL the app builds comes from NEXT_PUBLIC_SITE_URL or
-- the request's own origin.
--
-- ORDER OF OPERATIONS: deploy the application code before running this.
-- The old settings form writes both columns on save, and would start
-- failing the moment they are dropped.

UPDATE accounts a
SET name = btrim(s.website_name)
FROM showcase_settings s
WHERE s.account_id = a.id
  AND s.website_name IS NOT NULL
  AND btrim(s.website_name) <> ''
  AND btrim(s.website_name) IS DISTINCT FROM a.name;

ALTER TABLE showcase_settings DROP COLUMN IF EXISTS website_name;
ALTER TABLE showcase_settings DROP COLUMN IF EXISTS website_url;
