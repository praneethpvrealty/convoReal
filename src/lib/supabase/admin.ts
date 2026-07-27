import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazy, shared service-role client for server-side work that has to
 * bypass RLS — webhooks, cron jobs, background workers, and the
 * cross-tenant reads behind the platform admin screens.
 *
 * Twenty-five modules used to declare their own copy of this singleton,
 * including two byte-identical `admin-client.ts` files whose comments
 * each said they mirrored the other. They also each spelled the env
 * lookup as a `!` non-null assertion, so a missing key surfaced as an
 * opaque failure inside supabase-js rather than as the configuration
 * problem it is.
 *
 * SERVER ONLY. This key bypasses every row-level security policy —
 * importing it into a client component would hand a browser full
 * read/write access to every tenant. Callers must still scope their
 * queries by `account_id` in code; RLS is not there to catch them.
 */
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error(
        "Service-role Supabase client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }
    _adminClient = createClient(url, serviceRoleKey);
  }
  return _adminClient;
}
