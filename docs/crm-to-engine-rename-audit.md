# "CRM" → ConvoReal Engine — Rename Audit

One commit. **157 files, 530 insertions, 505 deletions.** Every occurrence of "CRM" in the repository was reviewed individually; this document records what changed, what deliberately did not, and the four items that need action outside the codebase.

Verification: `npm run lint`, `npm run typecheck`, `npm test` (1594 tests, 135 files), `npm run build` all pass. Mobile `typecheck` and `test` (79 tests, 9 files) pass.

---

## 1. Act on these before deploying

| # | What | Why | Action |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_CRM_VERTICAL` → `NEXT_PUBLIC_ENGINE_VERTICAL` | No fallback was kept. Vercel still holds the old name. | Add the new var in Vercel **before** the deploy. Failure mode is benign — it falls back to `real_estate`, which is what you run — but set it anyway. |
| 2 | `WACRM_PUBLIC_API_KEY` removed | It was the legacy fallback in `PUBLIC_API_KEY \|\| WACRM_PUBLIC_API_KEY` for the public properties API. | If any live integration authenticates with `WACRM_PUBLIC_API_KEY`, copy its value into `PUBLIC_API_KEY` first. **This one can break a third party silently.** |
| 3 | Migration `187_drop_crm_vocabulary_from_column_comments.sql` | Three column comments are live DB metadata, not repo text. | Run it against production. Comments only — no schema, data, policy or grant changes. |
| 4 | `CRM_BASE_URL` → `ENGINE_BASE_URL` in the Cloudflare Worker | `docs/CLOUDFLARE_EMAIL_SETUP.md` now documents the new name. | Rename the variable in the Cloudflare Worker settings, or the lead-sync worker falls back to its hardcoded default. |

---

## 2. Deliberately **not** renamed — and why

This is the "think twice" list. Each of these contains the letters `crm` and each was left alone on purpose.

| Location | Kept as | Reason |
|---|---|---|
| `next.config.ts:218,224` | `crm\.${escapedFrom}` | **A live redirect rule matching the `crm.` subdomain.** It is infrastructure, not branding. Delete it and anyone still hitting `crm.<olddomain>` gets nothing. The comment above it stays too — renaming it would make the comment describe a hostname the rule doesn't match. |
| `src/lib/favorites-storage.ts` | `LEGACY_KEY = "crm_favorites"` | Required by the localStorage migration (§4). Delete once every active session has loaded the app post-deploy. |
| `CHANGELOG.md` × 26 | `github.com/ArnasDon/wacrm/pull/…` | Working links to upstream fork PRs and issues. Rewriting them 404s them. |
| `docs/CLOUDFLARE_EMAIL_SETUP.md:70,115` | `https://wacrm.convoreal.com` | A real hostname the Worker points at. I can't verify whether it still resolves — **worth checking**, but a doc sweep is the wrong place to change DNS. |
| `CONTRIBUTING.md:99` | `wacrm.tech` | Accurate guidance about upstream-owned URLs in forks. |
| `AGENTS.md:13` | "originally forked from the `wacrm` template" | A true statement about the project's history. |
| `CHANGELOG.md:1192,1519` | "Every wacrm install…", "wacrm is intentionally…" | Dated entries describing the project as it was named at the time. |
| `extension/portal-autofill/portal-fill.js:73` | `crMatch` | Not CRM — that's **Cr**ore price parsing (`/^₹?\s*([\d.]+)\s*Cr/i`). |
| `package-lock.json`, `mobile/package-lock.json` | base64 integrity hashes | Coincidental substring inside SHA-512 digests. |

---

## 3. Vocabulary applied

| Context | Replacement | Example |
|---|---|---|
| Product brand | **ConvoReal Engine** / **the Engine** | `CONVOREAL CRM` → `CONVOREAL ENGINE` |
| Category / marketing | **deal engine** | `AI-Powered WhatsApp CRM & Property Portals` → `…WhatsApp Deal Engine & Property Portals` |
| Legacy fork name | **ConvoReal** | `Powered by waCRM.` → `Powered by ConvoReal.` |
| AI system prompts | **domain synonym, never "Engine"** | see §5 |

---

## 4. Changes worth reviewing closely

### 4.1 `crm_favorites` localStorage key — user data

The key held every favourite a user has ever starred, and was read in two components with duplicated parsing. A blind rename would have wiped all of them.

New file `src/lib/favorites-storage.ts` owns the key and migrates on first read: old key copied to `convoreal_favorites`, then removed. Both call sites (`favorite-button.tsx`, `favorites-card.tsx`) now go through it, so the migration can't run in one and not the other. Net effect: **no user loses a favourite.**

### 4.2 Extension manifest — a break that was caught

Renaming `crm-bridge.js` → `engine-bridge.js` left `extension/portal-autofill/manifest.json` pointing at the old filename. The Chrome extension would have silently stopped injecting its content script. Fixed; the manifest now references `engine-bridge.js`.

### 4.3 `/api/public/crm-lead` → `/api/public/engine-lead`

Moved with no redirect. I traced every caller first: three of our own components (`engine-lead-bot.tsx`, `engine-lead-form.tsx`, `showcase-lead-bot.tsx`) and nothing external. Confirmed registered in the build output.

### 4.4 Meta catalog `brand` field

`src/lib/whatsapp/meta-api.ts` sent `brand: 'waCRM Properties'` on every catalog product UPDATE; now `'ConvoReal Properties'`. Products already synced keep the old brand until they next sync.

### 4.5 PWA manifest

`src/app/manifest.ts` `name`/`short_name` were `waCRM` → `ConvoReal`. Users who already installed the PWA may keep the old label until the manifest is re-fetched.

### 4.6 Nominatim User-Agent

`ConvoRealCRM/1.0` → `ConvoReal/1.0`. Outbound identification only.

---

## 5. AI system prompts — the judgment call

**"CRM" in a prompt is a domain signal to Gemini.** Substituting "Engine" would have removed the word and degraded the prompt — "Engine" means nothing to a model. Each was rewritten to a synonym that carries the same meaning:

| File | Before | After |
|---|---|---|
| `src/lib/ai/gemini.ts` | `expert real estate CRM classifier` | `expert real estate lead classifier` |
| `src/lib/ai/gemini.ts` | `save a contact/lead in a CRM system` | `save a contact/lead in a contact database` |
| `src/lib/ai/record-edit.ts` | `You are a CRM data editor.` | `You are a record data editor.` |
| `src/lib/ai/preference-extraction.ts` | `expert real estate CRM analyst` | `expert real estate lead analyst` |
| `src/lib/calendar/event-parse.ts` ×2 | `scheduling assistant inside a CRM` | `scheduling assistant inside a sales platform` |
| `src/lib/calendar/event-parse.ts` | `already in the CRM` | `already in the contact database` |
| `src/lib/copilot/knowledge.ts` | `a WhatsApp CRM for Indian real-estate agents` | `a WhatsApp sales platform for Indian real-estate agents` |

`src/lib/ai/gemini.test.ts` asserts on prompt text and was updated in lockstep — the assertions still pin the real strings, so a future prompt edit still fails the test.

These are **behavioural changes to model input**, not cosmetic. Worth a spot-check of contact/property classification on real messages after deploy.

---

## 6. Everything else, by surface

| Surface | Count | Notes |
|---|---|---|
| Files renamed | 4 | `crm-lead-bot.tsx`, `crm-lead-form.tsx`, `api/public/crm-lead/`, `crm-bridge.js` |
| Files added | 2 | `favorites-storage.ts`, migration `187` |
| Identifiers | ~40 | `CrmLeadForm`→`EngineLeadForm`, `crmFunnel`→`engineFunnel`, `FUNNEL_CRM`/`'__crm__'`→`FUNNEL_ENGINE`/`'__engine__'`, `CRM_ROLE_CHIPS`, `CRM_TEAM_CHIPS`, `CRM_OPENERS`, `CRM_FUNNEL`, `crmTemplate*`, `handleCrmSendPersonal`, `sendPropertyViaCrm`→`sendPropertyViaEngine`, `CrmSendOutcome`, `leadsInCrm`, `crmlead:` rate-limit keys |
| SQL | 20 files | 19 migration/seed comment sweeps + new migration `187` for the 3 live `COMMENT ON` values. Source migrations 064/130/150 were updated too, so a fresh chain produces the new text and `187` is a no-op for it. |
| Markdown | 23 files | AGENTS, README, CHANGELOG, CONTRIBUTING, DATABASE_SCHEMA, FEATURE_ROADMAP, PROJECT_HANDOVER, `docs/*`, `.github/*`, `mobile/README`, extension README |
| Config | 2 | `package.json` description + keywords (`"crm"` → `"real-estate"`, `"deal-engine"`); `extension/portal-autofill/manifest.json` |

### Docs corrected because the rename made them wrong

Not vocabulary — these were already stale and the sweep surfaced them:

- `CONTRIBUTING.md` — `git clone …/wacrm.git && cd wacrm` → `convoreal` (the repo is `convoreal`)
- `docs/production-deployment.md` — Railway service and GitHub repo named `wacrm` → `convoreal`
- `docs/production-deployment.md` — `WHATSAPP_VERIFY_TOKEN` example value was literally `crm`; now `a-long-random-string`
- `docs/ultimate-whatsapp-onboarding-guide.md` — mermaid node read `CRM[ConvoReal CRM Engine]`, which the sweep turned into `ConvoReal Engine Engine`; corrected to `ConvoReal Engine`

---

## 7. The one deliberate exception: search

Dropping "CRM" everywhere is right for positioning and a **loss for search** — "WhatsApp CRM" is the phrase a broker types; "deal engine" is a phrase you are teaching them.

So exactly one occurrence was put back, by decision, in `src/app/page.tsx`:

```
'ConvoReal is a WhatsApp-first, AI-powered real estate CRM and deal engine
 connecting buyers, property owners, and agents. …'
```

Scope of that exception, precisely:

- **Meta description only.** Not the title (`…— AI-Powered WhatsApp Deal Engine & Property Portals` stands), not the `marketing.ts` badges, not a single string in the UI.
- **`src/app/page.tsx` only** — the sole indexed surface (`robots: { index: true }`). `src/app/layout.tsx` is `robots: { index: false, follow: false }`, so adding the word there would do no search work at all while putting it back in the codebase; it was left as "Self-hostable WhatsApp deal engine for real estate."

Net: "CRM" earns the search term where crawlers read it, and appears nowhere a customer reads as your product category. The description also got **shorter** (201 → 194 chars), so it truncates no worse in a SERP than before.

**If you re-run a repo-wide `CRM` grep, this is the one legitimate hit in `src/`.**

## 8. Not swept

`npm run format` was **not** run. Prettier reports style issues in **934 files** across the repo — pre-existing, and CI runs `lint`/`typecheck`/`test`/`build` rather than `format:check`. Reformatting would have buried a 157-file rename in a 934-file diff. Worth doing as its own commit.
