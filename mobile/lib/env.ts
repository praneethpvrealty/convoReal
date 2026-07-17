/**
 * Environment configuration.
 *
 * `EXPO_PUBLIC_*` vars are inlined at bundle time from `.env` /
 * `.env.development` / `.env.production` (see `.env.example`). They are
 * PUBLIC — never put service-role keys or secrets here; the anon key is
 * safe because every query goes through RLS.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name} — copy mobile/.env.example to mobile/.env and fill it in.`
    );
  }
  return value;
}

export const ENV = {
  supabaseUrl: required(
    'EXPO_PUBLIC_SUPABASE_URL',
    process.env.EXPO_PUBLIC_SUPABASE_URL
  ),
  supabaseAnonKey: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ),
  /** Base URL of the deployed Next.js web app, no trailing slash —
   *  all `/api/*` calls and relative `media_url` paths resolve against it. */
  apiBaseUrl: required(
    'EXPO_PUBLIC_API_BASE_URL',
    process.env.EXPO_PUBLIC_API_BASE_URL
  ).replace(/\/$/, ''),
};
