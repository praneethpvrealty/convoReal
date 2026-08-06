-- ============================================================
-- 207_restore_realtime_publication.sql
-- Re-assert supabase_realtime publication membership.
--
-- The publication is a database object, not a table property, so a
-- project restored from a schema dump (the ap-south-1 rehost) comes
-- up with an EMPTY supabase_realtime. Only tables added by a
-- migration that ran *after* the restore survived — `notifications`
-- (164) was the sole member, which is why the notification bell kept
-- updating live while the inbox silently stopped: no INSERT/UPDATE on
-- `messages` or `conversations` was ever replicated, so the web and
-- mobile channels subscribed successfully and then received nothing.
-- The list only refreshed on the resync paths (tab focus, reconnect,
-- manual refresh), which reads as "messages no longer arrive on their
-- own".
--
-- The ADD TABLE statements below already exist in 001 / 009 / 010 /
-- 090, all guarded by the same IF NOT EXISTS check — this migration
-- is a no-op on any database where they did run.
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'messages',
    'conversations',
    'message_reactions',
    'flow_runs',
    'credit_wallets',
    'notifications'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = t
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
