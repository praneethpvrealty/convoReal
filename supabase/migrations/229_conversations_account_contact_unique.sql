-- Backfills the FILE for an index that is already in the database.
--
-- conversations_account_contact_unique exists on the live project —
-- applied directly, under a migration name whose SQL never reached the
-- repo. Nothing here changes production; it makes a fresh environment
-- come out the same shape, which is the entire job of a checked-in
-- migration.
--
-- The index is load-bearing. One contact has one thread per account,
-- and several paths create a conversation when they cannot find one
-- (share-property's "Open chat" fallback, the webhook's inbound
-- handler, the Den notifier). Without the constraint two of them
-- racing produce two threads for the same person, and every later
-- lookup that takes the first row starts answering into whichever one
-- it happens to find.
--
-- IF NOT EXISTS, so re-running against the project that already has it
-- is a no-op rather than an error.
--
-- Recovered verbatim from pg_indexes rather than reconstructed from
-- memory: the definition below is what is actually deployed.

CREATE UNIQUE INDEX IF NOT EXISTS conversations_account_contact_unique
  ON public.conversations USING btree (account_id, contact_id);
