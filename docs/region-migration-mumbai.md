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
| Upstash Redis | Sydney | New DB, `ap-south-1` | Minutes — it's a queue/cache, no data worth moving |
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
4. Dry-run the schema restore into the new project **now** (steps 2–3
   below) to surface surprises while the old project is still
   authoritative. Wipe the new DB after (`supabase db reset --linked`
   against the new project) before the real run.

### 1. Freeze writes

- Vercel: put the site into the maintenance window (or simply accept
  brief errors — the webhook is the only high-frequency writer).
- Pause the go-ingress worker (Railway → service → Sleep) so queued
  WhatsApp events stop draining into the old DB.

### 2. Dump the old database

```bash
# Connection strings: Supabase dashboard → Project Settings →
# Database → Connection string (use the *direct* connection, port 5432).
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

This carries the full schema (all 150 migrations' worth), every RLS
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

Bucket definitions + files (property images, avatars) live in
Supabase Storage, not in the SQL dump. Use the community migration
script (https://github.com/supabase-community/storage-migration) or a
simple loop with the two service-role keys: list objects per bucket
from the old project, upload to the same bucket/path on the new one.
Verify a handful of image URLs render from the new project.

### 5. Cut over

Update environment variables everywhere they exist (Vercel project
env, go-ingress service env, worker env):

```
NEXT_PUBLIC_SUPABASE_URL=https://<NEW_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new anon key>
SUPABASE_SERVICE_ROLE_KEY=<new service role key>
REDIS_URL=rediss://default:<pw>@<new-upstash-host>:<port>   # Mumbai Upstash
```

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

## Rollback

Until step 5, nothing has changed for users. After cutover, rollback
is just restoring the old env vars — the Sydney project is untouched
by the migration. Any data written to Mumbai in between would need a
manual re-sync, which is why the freeze in step 1 matters.
