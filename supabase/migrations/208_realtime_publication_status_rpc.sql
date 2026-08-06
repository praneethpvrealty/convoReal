-- ============================================================
-- 208_realtime_publication_status_rpc.sql
-- Read supabase_realtime's membership from the application.
--
-- Migration 207 restored the publication after the ap-south-1 rehost
-- dropped it. Nothing would have told us it was gone: PostgREST cannot
-- select from a system catalog, so the app had no way to see its own
-- replication state, and the only symptom was an Inbox that quietly
-- stopped updating.
--
-- This exposes that state as one array so /api/cron/realtime-
-- publication-check can compare it against the tables the web and
-- mobile clients subscribe to.
--
-- Cross-tenant by construction — a publication has no account_id.
-- EXECUTE is revoked from anon/authenticated and granted only to
-- service_role; the sole caller is the cron route, which authenticates
-- with the shared cron secret.
-- ============================================================

CREATE OR REPLACE FUNCTION public.realtime_publication_tables()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(tablename ORDER BY tablename), ARRAY[]::TEXT[])
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public';
$$;

REVOKE ALL ON FUNCTION public.realtime_publication_tables() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.realtime_publication_tables() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.realtime_publication_tables() TO service_role;
