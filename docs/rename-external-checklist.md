# External changes checklist — Engine rename + fork cleanup

Everything the rename needs that **isn't in the repo**. Ordered: items 1–2 must happen *before* the deploy, the rest can follow.

Console UIs move around; the paths below are right as of writing, and the setting name is what to search for if a menu has shifted.

---

## Before you deploy

### 1. Vercel — add `NEXT_PUBLIC_ENGINE_VERTICAL`

**Project → Settings → Environment Variables**

| | |
|---|---|
| Name | `NEXT_PUBLIC_ENGINE_VERTICAL` |
| Value | `real_estate` |
| Environments | Production, Preview, Development |

The old `NEXT_PUBLIC_CRM_VERTICAL` is no longer read. Delete it once the new one is in.

*If you skip this:* nothing breaks. `src/config/marketing.ts` falls back to `'real_estate'`, which is the value you were running. Do it anyway so the fallback isn't load-bearing.

> `NEXT_PUBLIC_*` values are inlined at build time, not read at runtime — so this must be set **before** the build, and changing it later needs a redeploy, not just a restart.

### 2. Vercel — confirm `PUBLIC_API_KEY` is set

**Project → Settings → Environment Variables**

`src/app/api/public/properties/route.ts` used to accept either `PUBLIC_API_KEY` or `WACRM_PUBLIC_API_KEY`. The legacy name is gone.

- If `PUBLIC_API_KEY` is already set → nothing to do.
- If only `WACRM_PUBLIC_API_KEY` was set → **copy its value into `PUBLIC_API_KEY` before deploying.**

*If you skip this:* any integration calling `/api/public/properties` starts getting rejected, silently, from the moment the deploy lands. This is the only item on this list that can break a third party.

---

## After you deploy

### 3. Supabase — run migration 187

**SQL Editor → New query →** paste `supabase/migrations/187_drop_crm_vocabulary_from_column_comments.sql` → Run.

Three column comments are live database metadata, so editing the repo doesn't change them. Comments only — no schema, data, policy, or grant changes, and safe to run twice.

Verify:

```sql
SELECT col_description('properties'::regclass, attnum)
FROM   pg_attribute
WHERE  attrelid = 'properties'::regclass AND attname = 'notes';
```

Should say "visible only in the Engine".

### 4. Cloudflare — rename the Worker variable

**Workers & Pages → your lead-sync worker → Settings → Variables**

Rename `CRM_BASE_URL` → `ENGINE_BASE_URL`, same value. Redeploy the worker.

*If you skip this:* the worker falls back to its hardcoded default (`https://app.convoreal.com`) and lead-sync emails post to the wrong host — or nowhere.

### 5. Cloudflare — two email aliases

**Email → Email Routing → Routing rules → Create address**

| Address | Forwards to | Used by |
|---|---|---|
| `security@convoreal.com` | your inbox | `.github/SECURITY.md` |
| `conduct@convoreal.com` | your inbox | `.github/CODE_OF_CONDUCT.md` |

Both files now publish these addresses on a **public** repo. Until they route, security reports bounce.

Also turn on **Settings → Code security → Private vulnerability reporting** so the GitHub Advisories link in `SECURITY.md` actually works.

### 6. GitHub — repo description and homepage

**Repo main page → About (gear icon)**, or **Settings → General**

| Field | Currently | Change to |
|---|---|---|
| Description | `Whatsap based crm tailered to real` | `WhatsApp-first deal engine for real-estate brokerages` |
| Website | `https://wacrm-ruddy.vercel.app` | `https://www.convoreal.com` |

Both render at the top of a public repo page. The homepage URL is the most visible remaining trace of the fork, and the description has two typos plus "crm".

### 7. Check `wacrm.convoreal.com`

The Cloudflare guide used to default to this host; it now defaults to `app.convoreal.com`.

- If `wacrm.convoreal.com` is **live and serving the app** → either add `app.convoreal.com` in **Vercel → Settings → Domains** and point DNS at it, or set `ENGINE_BASE_URL` (item 4) explicitly to the hostname you actually use.
- If it's **dead** → nothing to do; item 4 covers it.

Either way, setting `ENGINE_BASE_URL` explicitly means the default never matters.

### 8. Meta catalog — re-sync to pick up the brand change

Catalog products were pushed with `brand: 'waCRM Properties'` and now go out as `'ConvoReal Properties'`. Existing products keep the old brand until they're next updated. Re-sync inventory from the app, or leave it — the field is cosmetic and self-heals as listings change.

---

## Nothing to do

- **PWA name.** `manifest.ts` now says `ConvoReal`. Already-installed devices may show the old label until the manifest is re-fetched; it corrects itself.
- **`crm_favorites` localStorage.** Migrates automatically on first load (`src/lib/favorites-storage.ts`). Once your active users have all loaded the app post-deploy, delete `LEGACY_KEY` from that file.
- **The `crm.` subdomain redirect** in `next.config.ts` stays. It's live infrastructure, not branding.

---

## After it's all green

Bump `package.json` `"version"` off `0.2.2` — that was the upstream template's last release number, and its changelog entry is gone now. `0.3.0` reflects that this is your release line.
