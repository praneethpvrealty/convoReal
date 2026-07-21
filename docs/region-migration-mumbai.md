# Region Migration: Sydney → Mumbai (`ap-southeast-2` → `ap-south-1`)

## Why

The whole stack currently runs in AWS Sydney (per
`docs/production-deployment.md`): Supabase (database, auth, storage),
Upstash Redis, and Vercel functions matched to it. The team and every
customer are in India. Round-trip latency Bangalore ↔ Sydney is
~140–170 ms per request; pages like Contacts issue 6–8 *sequential*
database round trips (profiles → exclusion list → main page → four
count queries → tags), so every screen pays 1–1.5 s of pure network
latency on a *good* connection — and multiples of that on flaky
mobile data. Mumbai is ~15–40 ms from Bangalore: roughly a **5–8×
reduction** in time-to-data for every page, plus faster WhatsApp
webhook processing end-to-end.

Supabase cannot move a project between regions in place — migration
means creating a new project in `ap-south-1` and moving everything
into it.

## What moves

| Component | From | To | Effort |
|---|---|---|---|
| Supabase project (DB + auth + storage) | Sydney | New project, Mumbai `ap-south-1` | The main event |
| Upstash Redis | Sydney | New DB, `ap-south-1` | Minutes — it's a queue/cache, no data worth moving (drain first, see step 1) |
| Vercel functions | Sydney | `bom1` (Mumbai) | One dashboard setting |
| Go ingress (Railway/Render) | (wherever it runs) | Asia region | Redeploy with new env |

## Runbook

Do this in a quiet window (e.g. late night IST). Realistic wall time:
1–2 hours, most of it storage-file copying. WhatsApp messages that
arrive during the cutover are retried by Meta for hours, so a short
window loses nothing.

### 0. Prep (before the window)

1. Create the new Supabase project in **AWS Mumbai (`ap-south-1`)**.
   Note the new URL + anon key + service-role key + JWT secret.
2. Create a new Upstash Redis DB in `ap-south-1`; note the
   `rediss://` URL.
3. Install the Postgres 15+ client tools and the Supabase CLI
   locally.
4. Mirror the dashboard-level auth config in the new project — none
   of this travels in the SQL dump:
   - **Google OAuth provider** (client ID/secret), and add the new
     callback `https://<NEW_REF>.supabase.co/auth/v1/callback` to the
     OAuth client in Google Cloud Console.
   - **Site URL and redirect URLs** (convoreal.com).
   - **Send-SMS hook** → `https://convoreal.com/api/auth/sms-hook`
     (powers WhatsApp OTP sign-in). Note the new hook secret for the
     `SUPABASE_SMS_HOOK_SECRET` env var at cutover.
   - Custom SMTP settings, if configured.
5. Dry-run the schema restore into the new project **now** (steps 2–3
   below) to surface surprises while the old project is still
   authoritative. Wipe the new DB after (`supabase db reset --linked`
   against the new project) before the real run.

### 1. Freeze writes

- Vercel: put the site into the maintenance window (or simply accept
  brief errors — the webhook is the only high-frequency writer).
- Let the queue worker drain both Redis queues (`whatsapp-webhooks`
  and `listing-videos`) to empty — `LLEN` both keys — then pause the
  go-ingress service and the worker (Railway → service → Sleep) so
  queued events stop draining into the old DB. Any listing-video job
  still queued at cutover dies with the old Redis; re-trigger it from
  the property page afterwards.

### 2. Dump the old database

```bash
# Connection strings: Supabase dashboard → Project Settings →
# Database → Connection string (use the *direct* connection, port 5432).
# If the direct host is unreachable (newer projects are IPv6-only on
# direct), use the *session* pooler string instead — never the
# transaction pooler for pg_dump/restore.
OLD_DB="postgresql://postgres:<OLD_PASSWORD>@db.cvmgojajtegbuuujtptn.supabase.co:5432/postgres"

# Roles, then schema+data. --clean/--if-exists make the restore
# idempotent if you need a second attempt.
pg_dumpall --roles-only -d "$OLD_DB" > roles.sql
pg_dump -d "$OLD_DB" \
  --clean --if-exists --quote-all-identifiers \
  --exclude-schema 'supabase_functions' \
  --exclude-schema 'storage' \
  -n public -n auth -n extensions \
  -f dump.sql
# storage schema is excluded above: the new project provisions its own;
# object METADATA is recreated by the file copy in step 4.
```

### 3. Restore into the Mumbai project

```bash
NEW_DB="postgresql://postgres:<NEW_PASSWORD>@db.<NEW_REF>.supabase.co:5432/postgres"

psql -d "$NEW_DB" -f roles.sql   # ignore "role already exists" noise
psql -d "$NEW_DB" -f dump.sql
```

This carries the full schema (all 160+ migrations' worth), every RLS
policy, functions/triggers (including `handle_new_user` and the
template-seeding trigger), **and all data including `auth.users` with
password hashes** — users keep their logins and sessions re-establish
on next refresh.

Sanity checks:

```sql
select count(*) from contacts;          -- matches old project
select count(*) from auth.users;        -- matches old project
select count(*) from message_templates; -- matches old project
```

### 4. Copy storage files

Bucket definitions + files live in Supabase Storage, not in the SQL
dump. There are five buckets: `avatars`, `flow-media`,
`property-images`, `property-documents`, `property-videos`. Their
definitions (public flags, size limits, MIME allowlists) and their
`storage.objects` policies come from migrations `008`, `016`, `022`,
`058`, and `152` — re-run those migrations against the new project
first, or let the migration script create the buckets. Then copy files with the community migration
script (https://github.com/supabase-community/storage-migration) or a
simple loop with the two service-role keys: list objects per bucket
from the old project, upload to the same bucket/path on the new one.
Verify a handful of image URLs render from the new project.

**Make stored media references host-independent.** Historically the
upload helpers persisted ABSOLUTE public URLs (with the project ref) into
`properties.images`, `.documents`, `.video_url`, `profiles.avatar_url`,
`flow_nodes.config`, etc. After the DB dump those rows still point at the
old project, so the live app keeps fetching media from it. The permanent
fix:

1. Deploy the app. Reads now resolve stored media through
   `src/lib/storage/url.ts`, which rebuilds the URL from the current host
   (and re-bases any absolute Supabase URL) at read time.
2. Run `scripts/migrate-storage-urls.sql` once in the new project's SQL
   editor. It strips the host from every stored value, leaving only the
   bucket-relative path — so the data is portable and **no future
   migration will ever need a URL rewrite again.**

Order matters: run the script only AFTER the app is deployed — bare
relative paths render only through the resolver. (If you must fix the data
before deploying, do a host-to-host rewrite instead — see the note at the
top of the script.)

Then watch the OLD project's Storage logs: real user image reads must fall
to zero before you delete it (allow 24–48h for browser/CDN cache).

### 5. Cut over

Update environment variables everywhere they exist (Vercel project
env, go-ingress service env, worker env):

```
NEXT_PUBLIC_SUPABASE_URL=https://<NEW_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new anon key>
SUPABASE_SERVICE_ROLE_KEY=<new service role key>
SUPABASE_SMS_HOOK_SECRET=<new hook secret from prep step 4>
REDIS_URL=rediss://default:<pw>@<new-upstash-host>:<port>   # Mumbai Upstash
```

The mobile app embeds `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` in the app bundle — ship a new
build/EAS Update with the new values, or installed apps keep talking
to the paused Sydney project.

Everything else is unchanged: `ENCRYPTION_KEY` (app-level, carried in
the DB rows it encrypted), WhatsApp webhook URL (points at
convoreal.com), Meta OAuth redirect URIs (your domain).

Then:

1. Vercel → Project Settings → Functions → Region → **Mumbai
   (`bom1`)**. Redeploy.
2. Move/redeploy go-ingress to an Asia region with the new env; wake
   the worker.
3. Un-pause everything.

### 6. Verify

- Log in on a phone on mobile data: profile name appears, Contacts
  loads fast, counts real.
- Send a WhatsApp message to the business number → appears in Inbox.
- Send a template from Settings (dry-run flag off) → submits.
- Upload a property image → renders.

### 7. Decommission

Keep the Sydney project **paused, not deleted, for 2–4 weeks** as a
fallback, then delete. (Paused projects don't bill for compute.)

Before deleting, confirm the stored-URL rewrite above is done: the old
project's Storage logs should show no real user media reads (only Supabase
infra health checks), and `grep`-style checks against the new DB should
find zero rows still referencing the old ref. Deleting the old project
also permanently invalidates its leaked `service_role` key.

## Rollback

Until step 5, nothing has changed for users. After cutover, rollback
is just restoring the old env vars — the Sydney project is untouched
by the migration. Any data written to Mumbai in between would need a
manual re-sync, which is why the freeze in step 1 matters.
