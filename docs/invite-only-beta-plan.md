# Invite-Only Beta — Program & Implementation Plan

Status: **implemented**. Migrations `188`–`190`, routes under `/api/beta-invites` and `/api/bug-reports`, the `/i/[token]` page, Settings → Invites, and Admin → Bugs are all in the repo. See §10 for where the build deviated from this plan and why.
Target: **100 accounts in 30 days**, invite-only, **5 invites per account**, with a first-class bug-report channel.

---

## 0. Decisions this plan assumes

The three open choices were resolved to the recommended defaults. Change any of them and the affected section is called out.

| Decision | Chosen | Affects |
|---|---|---|
| Seeding shape | 17 founder seeds × (1 + 5) = **102** | §2, §7 |
| Bug reports | **In-app widget → `bug_reports` table**, admin triage in `/admin` | §6 |
| Deliverable | Plan + invitation creative now; implementation on approval | all |

---

## 1. The thing that does not exist yet

ConvoReal already has **two** invite-shaped systems, and neither one does what this program needs.

| Existing | What it actually does | Why it isn't this |
|---|---|---|
| `account_invitations` + `/join/[token]` (migrations 017, 019) | Invites a person **into an existing account** as `admin`/`coordinator`/`agent`/`viewer`. `redeem_invitation()` *deletes* the invitee's personal account and moves their profile across. | It grows a team inside one tenant. It never creates a tenant. |
| `credit_wallets.referral_code` + `?ref=CODE` (migrations 086, 088) | Attribution + credit rewards on an **open** signup. | It rewards signups; it does not gate them. Unlimited, not 5. |

What the beta needs is a third thing: an invite that **authorizes the creation of a new account**. Call it a **beta invite**. It is deliberately a separate table and a separate URL space so that nothing about team invites or referral credits has to change.

> **Naming/route note:** `/join/[token]` is taken by team invites. Beta invites get `/i/[token]` — short enough to read out over a phone call, and no collision.

---

## 2. Program mechanics

```
                    ┌─────────────────────────┐
                    │  17 founder seed invites │   generation 0
                    └────────────┬─────────────┘
                                 │ each accepted → 1 account
                    ┌────────────▼─────────────┐
                    │      17 accounts          │
                    │  × 5 invites each = 85    │   generation 1
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  up to 85 more accounts   │
                    └───────────────────────────┘

  17 + 85 = 102 possible  ·  hard cap 100  ·  last 2 land on the waitlist
```

**Why 17 seeds and one hop, not 4 seeds and two hops.** Two hops (4 × (1+5+25) = 124) only reaches 100 if wave 1 actually invites — which is exactly the behaviour a 30-day beta cannot assume. 17 seeds put 17 accounts on the board on day 1 regardless of anyone's enthusiasm, and the tree is one level deep so every account is at most one degree from a founder-vetted broker. Realistic redemption is 60–70%, so plan to **hold ~6 seeds in reserve** and issue them in week 3 against the actual shortfall.

**Rules.**

1. Account creation requires a valid, unexpired, unredeemed beta invite. No exceptions in the product; founders mint seeds through an admin route.
2. Every account that completes signup gets a quota of **5** invites (`accounts.invite_quota`, per-account overridable).
3. Global cap of **100** accounts is enforced at *redemption*, not at issuance — see §4.3 for why.
4. Invite links expire in **14 days** (longer than the 7-day team-invite default: a broker who gets this on WhatsApp on a Friday should still be able to act on it after a site visit week).
5. The program has an end date. After it, `beta_invites` issuance is switched off by flipping one settings row; nothing needs a deploy.

---

## 3. Schema

### 3.1 `beta_invites`

```sql
CREATE TYPE beta_invite_status AS ENUM ('pending','accepted','revoked','expired');

CREATE TABLE IF NOT EXISTS beta_invites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,        -- "CONVO-7XKQ", speakable
  token_hash          TEXT NOT NULL UNIQUE,        -- SHA-256 of the link token
  issued_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,  -- NULL = founder seed
  issued_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  generation          SMALLINT NOT NULL DEFAULT 0, -- 0 = seed, 1 = first hop
  label               TEXT,                        -- "Ravi — Prestige, Whitefield"
  invitee_phone       TEXT,
  invitee_email       TEXT,
  status              beta_invite_status NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  accepted_at         TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_beta_invites_issuer
  ON beta_invites(issued_by_account_id) WHERE status <> 'revoked';
```

**Token handling mirrors `src/lib/auth/invitations.ts` exactly** — 32 random bytes, base64url, SHA-256 at rest, plaintext returned once. That file's `generateInviteToken()` / `hashInviteToken()` are reused verbatim; only `inviteUrl()` needs a sibling that builds `/i/<token>`.

> **§2.6 exception, stated deliberately.** `beta_invites` has **no `NOT NULL account_id`**. It cannot: at issuance time for a seed there is no account, and the whole point of the row is to authorize the creation of one. It sits with `accounts` and `profiles` as a *platform* table, not an operational one. `issued_by_account_id` is nullable-by-design and is the column every tenant-facing query filters on. RLS is still enabled (§3.4).

### 3.2 `accounts` additions

```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS beta_invite_id UUID REFERENCES beta_invites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invite_quota   SMALLINT NOT NULL DEFAULT 5;
```

`invites_used` is **not** stored. It is `COUNT(*) FROM beta_invites WHERE issued_by_account_id = $1 AND status <> 'revoked'`, computed under a row lock inside `issue_beta_invite()`. A denormalized counter would drift the first time an invite is revoked or an account is deleted; the count is over at most 5 rows on an indexed column.

### 3.3 `beta_program` (singleton settings)

```sql
CREATE TABLE IF NOT EXISTS beta_program (
  id                 BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  account_cap        INTEGER NOT NULL DEFAULT 100,
  default_quota      SMALLINT NOT NULL DEFAULT 5,
  invite_ttl_days    SMALLINT NOT NULL DEFAULT 14,
  issuance_open      BOOLEAN NOT NULL DEFAULT TRUE,
  program_ends_at    TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO beta_program (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
```

The cap, the quota, and the kill switch are data. Raising the beta from 100 to 250 is an `UPDATE`, not a deploy.

### 3.4 RLS

- `beta_invites`: `SELECT`/`UPDATE` where `is_account_member(issued_by_account_id, 'admin')`. Seeds (`issued_by_account_id IS NULL`) are invisible to every tenant. `INSERT` goes through `issue_beta_invite()` only — no direct-insert policy.
- `beta_program`: no tenant policy at all. Read via `SECURITY DEFINER`, written by the service role.
- `bug_reports`: standard `is_account_member(account_id)` (§6).

---

## 4. Making signup invite-only

This is the load-bearing part of the plan, and the place with the most sharp edges.

### 4.1 The gate belongs in `handle_new_user()`, not in the UI

`/signup` refusing to render a form without `?invite=` is a courtesy, not a control — `supabase.auth.signUp()` is a public endpoint callable from anywhere with the anon key. The only real gate is the `auth.users` trigger, because a `RAISE EXCEPTION` there aborts the `auth.users` insert and Supabase returns a signup error to the client.

### 4.2 The current trigger swallows everything — that must change first

`handle_new_user()` (live version: migration 099) ends with:

```sql
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
```

A gate that raises inside that block is a gate that does nothing. The migration must **hoist the invite check above the guarded section** so it raises out of the function uncaught, while leaving the existing bootstrap logic's swallow-all behaviour intact for everything else (changing that is a separate, riskier decision — migration 099's comment history shows this trigger has already silently broken signup twice).

### 4.3 Three signup paths, only one of which is gated

This is the detail most likely to break production if missed. `handle_new_user()` currently serves three distinct cases:

| Path | Trigger behaviour today | Under invite-only |
|---|---|---|
| **New tenant** — no phone match, no team invite | Creates a fresh `accounts` row, role `owner` | **GATED.** Requires a valid beta invite. |
| **Teammate joining** — signed up from `/signup?invite=<team-token>` | Creates a throwaway personal account, then `redeem_invitation()` deletes it and moves the profile | **NOT gated.** Must accept a valid `account_invitations` token as authorization instead. Otherwise every existing customer loses the ability to add staff. |
| **Phone match** (migration 067) | Attaches the new user to an existing account by last-10-digit phone match | **NOT gated.** No new tenant is created. |

So the gate condition is precisely: *"we are about to `INSERT INTO accounts`, and the caller presented neither a valid beta invite nor a valid team invite."*

The client passes the plaintext token in signup metadata; the trigger hashes it in-database with `encode(digest(token,'sha256'),'hex')` (pgcrypto, already available — `uuid-ossp`/`pgcrypto` are in use from migration 001) and looks up both tables:

```
raw_user_meta_data->>'beta_invite'  → beta_invites.token_hash
raw_user_meta_data->>'team_invite'  → account_invitations.token_hash
```

The trigger only *validates* the beta invite; it does **not** mark it accepted, because at that instant the account row doesn't exist yet and email verification hasn't happened. Redemption is finalized in `redeem_beta_invite()` (§4.5).

### 4.4 The global cap is checked at redemption

Checking the cap at *issuance* would mean minting 102 links and then telling the 101st person "sorry" at the door anyway — the failure just moves. Checking at *redemption*, inside the same locked transaction that stamps `accepted_at`, is the only place the count is actually authoritative:

```sql
SELECT COUNT(*) FROM accounts WHERE beta_invite_id IS NOT NULL
  -- vs beta_program.account_cap, under a lock on the beta_program row
```

When the cap lands, a nightly cron flips remaining `pending` invites to `expired`, and `/i/<token>` renders the "beta is full — join the waitlist" state (§5.3) rather than a broken link.

### 4.5 Server surface

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/beta-invites/[token]/peek` | anon, rate-limited | Renders the invite page: inviter's name, expiry, seats left. Mirrors `peek_invitation` — uniform `{ok, reason?}` JSON, per-IP limit reusing `RATE_LIMITS.invitationPeek`. |
| `POST /api/beta-invites/[token]/redeem` | authed | Stamps `accepted_at`, links `accounts.beta_invite_id`, sets `invite_quota`, enforces the cap. Reuses `RATE_LIMITS.invitationRedeem`. |
| `GET /api/beta-invites` | authed, `admin`+ | The account's own 5 invites and their status. |
| `POST /api/beta-invites` | authed, `admin`+ | `issue_beta_invite()` — quota-checked, returns plaintext token once. `RATE_LIMITS.adminAction`. |
| `DELETE /api/beta-invites/[id]` | authed, `admin`+ | Revoke an unredeemed invite; frees a seat. |
| `POST /api/admin/beta-invites/seed` | service-role + `CONVOREAL_MASTER_ACCOUNT_ID` | Mint generation-0 seeds. |

New rate-limit entries are unnecessary — the four existing buckets fit exactly.

### 4.6 OAuth and the SMS/WhatsApp OTP path

An OAuth signup carries no `raw_user_meta_data.beta_invite`, so it hits the gate and is rejected — correct, but the user sees a raw Supabase error. Either disable OAuth providers for the beta (simplest, recommended) or stash the token in the OAuth `state` and re-attach it. The same applies to the WhatsApp OTP hook (`/api/auth/sms-hook`) — verify whether it can mint a new `auth.users` row without going through `/signup`, and gate that entry point identically.

---

## 5. The invitation itself

Three surfaces, one message. The creative is in **`docs/invite-creative/beta-invite.html`** (open it in a browser, or view the published preview).

### 5.1 WhatsApp — the primary channel

ConvoReal is a WhatsApp product; the invite should arrive the way the product works. **Sent personally by the inviter via copy-paste, not by the platform.** That is deliberate: a platform-sent MARKETING template needs Meta approval, burns the 24-hour window rules, and reads like a blast. A broker forwarding a note to another broker is the entire social proof of the program.

The invite UI gives a one-tap **"Share on WhatsApp"** button (`https://wa.me/?text=…`) pre-filled with:

> Hey — I'm on the ConvoReal beta and I've got a seat for you.
>
> It's a WhatsApp-first Engine built for how we actually work: enquiries land as chats, inventory and matching in one place, no more Excel + 6 portals.
>
> Only 100 brokerages get in this month. Your link (expires in 14 days):
> https://convoreal.com/i/XXXX
>
> — Praneeth

Short, no marketing voice, states the scarcity as a fact rather than a hook, and names the sender.

### 5.2 Email — the fallback

Same copy, rendered through `sendTransactionalEmail()` from `src/lib/email.ts` (Resend, already wired). Needed because some invitees are reachable by email only, and because it survives a WhatsApp number change.

### 5.3 `/i/[token]` — the landing page

Five states, driven by peek result × auth state:

| State | Renders |
|---|---|
| `ok` | Inviter's name, seats remaining out of 100, expiry countdown, what the beta asks for, **Claim my seat** |
| `expired` | "Ask *[inviter]* for a fresh link" — inviter named, so there's an action |
| `used` | "This seat has been claimed" + waitlist form |
| `revoked` / `not_found` | Generic, plus waitlist |
| `program_full` | "All 100 seats are taken" + waitlist |

Every dead-end state ends in a **waitlist capture**, not a wall. An invite-only launch generates forwarded links by design; the people who arrive at a spent link are the warmest leads the program produces, and dropping them is the single biggest avoidable loss in this plan.

**What makes it attractive** — and this is a design constraint, not decoration:

- **The number is the hero.** "Seat 34 of 100" is the whole proposition. It renders large, live from the peek response.
- **Named inviter, with their brokerage.** Trust transfers from the person, not the brand.
- **Honest about being a beta.** It states what's expected (use it for real work, report what breaks) and what's given (free through the program, direct line to the team, 5 seats to pass on). Overselling a beta produces churn in week 2.
- **Reads on a 360px screen.** The audience opens this from a WhatsApp chat on a mid-range Android phone. That is the design target; desktop is the afterthought.
- **Dark glass, verdant accent** — consistent with the app's own aesthetic (`bg-slate-900/50 border border-slate-800 rounded-xl`), so the landing page and the product feel like one thing.

### 5.4 Post-signup: the invite hub

Once in, the account owner sees **Settings → Invites**: 5 seat cards, each either empty (with a **Generate link** button), pending (link + copy + WhatsApp share + revoke), or claimed (who claimed it, when). Modelled on the existing `src/components/settings/invite-member-dialog.tsx` and `ReferralHub.tsx` so it needs no new UI vocabulary.

---

## 6. Bug reports

Beta testers who can't report a bug in under 15 seconds don't report bugs.

### 6.1 Schema

```sql
CREATE TYPE bug_severity AS ENUM ('blocker','major','minor','idea');
CREATE TYPE bug_status   AS ENUM ('new','triaged','in_progress','fixed','wont_fix','duplicate');

CREATE TABLE IF NOT EXISTS bug_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reported_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  body               TEXT NOT NULL,
  severity           bug_severity NOT NULL DEFAULT 'minor',
  status             bug_status   NOT NULL DEFAULT 'new',
  page_url           TEXT,
  build_id           TEXT,          -- NEXT_PUBLIC_BUILD_ID, so we know the exact deploy
  user_agent         TEXT,
  screenshot_path    TEXT,          -- Supabase Storage
  admin_notes        TEXT,
  github_issue_url   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Standard operational table: `account_id NOT NULL`, RLS on, `set_updated_at` trigger, `is_account_member()` policies. `build_id` is the field that makes a report actionable a week later — "it broke on Tuesday" is not a bug report, `4f0533e` is.

### 6.2 Capture

A floating **Report a bug** pill in `DashboardShell`, present on every dashboard route, plus <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>. The sheet asks for two things — *what happened* and *how bad* — and silently attaches `page_url`, `build_id`, `user_agent`, and an optional screenshot. Two fields, because four fields halves the submission rate.

Confirmation matters as much as capture: the tester sees a reference number and, on triage, an in-app `notifications` row when the status changes. A beta tester who reports three bugs into silence stops at three.

`POST /api/bug-reports` (authed, `RATE_LIMITS.adminAction` shape) and `GET /api/bug-reports` (own account's reports).

### 6.3 Triage

A **Bugs** tab in `/admin`, alongside the existing `billing-tab.tsx` / `marketplace-tab.tsx`, scoped to `CONVOREAL_MASTER_ACCOUNT_ID`: all reports across all beta accounts, filterable by severity and status, with the reporter's account name. One-click **promote to GitHub issue** writes the resulting URL back to `github_issue_url` — the table stays the source of truth, GitHub gets the engineering workflow.

### 6.4 Phase 2 — WhatsApp reports

Replying `BUG <text>` to the ConvoReal number lands a `bug_reports` row via the existing funnel machinery in `src/lib/bot/funnels.ts`. Highest-fidelity channel for this audience, but it depends on the tester's number being linked to their account, so it ships after the widget rather than instead of it.

---

## 7. Rollout — 30 days

| Week | Engineering | Program |
|---|---|---|
| **0** (pre-launch) | Migration 188 (`beta_invites`, `accounts` columns, `beta_program`), gated `handle_new_user()`, seed route. Verify **all three signup paths** in §4.3 on a Supabase branch before touching prod. | Draft the 17-broker seed list. |
| **1** | `/i/[token]`, peek + redeem routes, Settings → Invites hub. | Mint + send 17 seeds. Founder onboards each personally — a 10-minute call per seed is what converts a claimed seat into an active account. |
| **2** | Bug-report widget, table, `/admin` Bugs tab. | Wave-1 accounts get their 5 seats. Nudge the seeds who haven't invited. |
| **3** | Triage and fix. GitHub promotion. | Issue reserve seeds against the actual shortfall. |
| **4** | Stabilize. | Measure (§8). Decide: extend cap, or close and convert. |

### Risk register

| Risk | Mitigation |
|---|---|
| **Gated trigger breaks signup entirely** — this trigger has silently broken signup twice before (see migrations 098, 099 headers) | Test all three paths of §4.3 on a Supabase branch. `beta_program.issuance_open = false` is not a rollback — keep a one-statement revert of the trigger ready. |
| Team invites (`account_invitations`) collaterally blocked | §4.3 explicitly exempts them; needs a regression test, not just a code read. |
| Seeds claim but never invite | Reserve seats; founder-led onboarding call; week-2 nudge. |
| Cap reached, warm traffic wasted | Waitlist on every dead-end state (§5.3). |
| Forwarded link claimed by the wrong person | Optional `invitee_phone` binding on high-value seeds — verified at redemption against the WhatsApp OTP the product already requires. |
| Silence instead of bug reports | Status-change notifications; founder replies to the first report from every account. |

---

## 8. What "working" looks like

| Metric | Target |
|---|---|
| Accounts created | 100 by day 30 |
| Seed → account conversion | ≥ 70% (12 of 17) |
| Accounts that issue ≥ 1 invite | ≥ 50% |
| Accounts active in week 2 (any WhatsApp message sent) | ≥ 60% |
| Accounts filing ≥ 1 bug report | ≥ 40% |
| Median time from account creation to first real contact imported | < 48h |

The second-to-last row is the one that actually matters. A beta that produces 100 accounts and 4 bug reports produced 100 signups, not 100 testers.

---

## 9. Files this touches

**New**
```
supabase/migrations/188_beta_invites.sql
supabase/migrations/189_bug_reports.sql
src/lib/beta/invites.ts                  # sibling of lib/auth/invitations.ts
src/app/i/[token]/page.tsx
src/app/api/beta-invites/route.ts
src/app/api/beta-invites/[token]/peek/route.ts
src/app/api/beta-invites/[token]/redeem/route.ts
src/app/api/beta-invites/[id]/route.ts
src/app/api/admin/beta-invites/seed/route.ts
src/app/api/bug-reports/route.ts
src/components/settings/beta-invite-hub.tsx
src/components/support/bug-report-sheet.tsx
src/app/(dashboard)/admin/bugs-tab.tsx
```

**Modified**
```
src/app/(auth)/signup/page.tsx           # require ?invite=, pass token in metadata
src/app/(dashboard)/settings/page.tsx    # Invites section
src/app/(dashboard)/admin/page.tsx       # Bugs tab
src/components/layout/*shell*            # bug-report pill
src/lib/rate-limit.ts                    # no change — existing buckets reused
```

Roughly 13 new files and 5 edits. No new dependencies.

---

## 10. Where the build deviated from this plan

Six changes, each because the plan was wrong about something in the codebase rather than because the implementation took a shortcut.

### 10.1 The baseline for `handle_new_user()` is migration **160**, not 099

§4.2 said to build the gate on top of migration 099. That would have been a production outage.

`handle_new_user()` has been redefined seven times (001, 017, 067, 088, 099, 132, 160). The live body is **160's**, and it opens with a guard 099 does not have:

```sql
IF NEW.raw_user_meta_data->>'app_context' IN ('den','buyer') THEN
  RETURN NEW;
END IF;
```

Owners Den and buyer-portal users are `auth.users` rows with **no `profiles` row** — that absence *is* their isolation, because every Engine RLS policy gates through `profiles`. Rebuilding from 099 would have deleted that guard, started minting staff accounts for every property owner who logged in, and then — once the gate landed — rejected their WhatsApp OTP logins outright, locking both portals.

Migration 189 reproduces the guard **first**, before the gate. §4.3's three signup paths are really **four**, and the den/buyer path is the one that had to be checked before anything else.

### 10.2 `sha256()`, not pgcrypto's `digest()`

§4.3 specified `encode(digest(token,'sha256'),'hex')`. On Supabase, pgcrypto lives in the `extensions` schema, and every `SECURITY DEFINER` function here sets `search_path = public` — so `digest()` would not resolve at runtime.

`hash_beta_token()` uses the Postgres 11+ built-in instead:

```sql
encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
```

No extension dependency, and byte-identical to Node's `createHash('sha256')` — verified against the running database, and pinned by a unit test in `src/lib/beta/invites.test.ts`.

### 10.3 Redemption happens in the trigger, not in a later `redeem_beta_invite()`

§4.3 said the trigger should only *validate*, with redemption finalized separately after email verification. That leaves a window in which **one token creates unlimited accounts**, because nothing has been marked used yet — which defeats the entire mechanism.

The invite is now stamped `accepted` in the same transaction that creates the account. `plpgsql`'s `BEGIN/EXCEPTION` opens a subtransaction, so a failed bootstrap rolls the stamping back with it — a seat is never burned by a half-done signup.

The cost the plan was trying to avoid is real but small: an abandoned, never-verified signup holds a seat. It is self-healing, because `beta_seats_taken()` counts **accounts** — deleting the dead account returns the seat. There is no separate redeem route, and `/i/<token>` → `/signup?beta=<token>` is the whole flow.

### 10.4 No cron to expire invites when the cap lands

§4.4 called for a nightly job flipping pending invites to `expired` once the programme fills. `peek_beta_invite()` computes `program_full` live instead. A nightly job is stale between runs; this cannot be, and it's less code.

### 10.5 The waitlist reuses `/api/public/engine-lead`

§5.3 required waitlist capture on every dead-end state but didn't say where it lands. Rather than a new table, entries post to the existing prospect funnel with `source=beta_waitlist`, so they arrive in the master account's sales pipeline as tagged contacts with a note recording which dead end they hit. No new schema.

### 10.6 Migration numbers, and one extra kill switch

Numbers moved to **188** (`beta_invites`), **189** (the gate) and **190** (`bug_reports`) — 187 was taken by the CRM→Engine comment rename.

`beta_program` also gained `gate_enabled`, which §3.3 didn't have. `issuance_open` only stops *new* invites being minted; it does nothing about a gate that is misbehaving. `UPDATE beta_program SET gate_enabled = FALSE` restores open signup instantly with no deploy — the rollback §7's risk register asked for.

### Verification

The three migrations were applied to a scratch PostgreSQL 16 instance and the gate exercised end to end — 36 assertions, all passing: den/buyer bypass, valid redemption and seat stamping, reuse, unknown/expired/revoked tokens, team invites and phone matches passing through ungated and consuming no seat, the cap, the kill switch, seat reclamation on account delete, the 5-invite quota, revoke-and-reissue, and every `peek` envelope.

`beta_seats_taken()` counting accounts rather than accepted invites is what makes reclamation work, and it is tested.
