# WhatsApp Embedded Signup + Coexistence — Design & Implementation Plan

> **For the implementing model:** Implement in phase order (A → D); each phase is independently
> shippable. Read `AGENTS.md` first — this repo runs a breaking-changes Next.js 16; consult
> `node_modules/next/dist/docs/` before writing route/page code. Do NOT run DDL against the
> database — write migration files only; the owner applies them manually via the Supabase SQL
> editor. Do not commit; the owner commits. After every phase: `npm run typecheck`,
> `npx eslint <touched files>`, `npm test` — all must be clean.
>
> **Verify before you build.** Meta renames endpoints, fields and event names, and this area is
> actively changing (see §1.3). Treat every Graph API field name, event name and endpoint below as
> *design intent*, and check it against the live docs at implementation time rather than trusting
> this doc or training data. Primary sources are linked in §11.

---

## 1. Why this exists

### 1.1 The problem

Connecting a WhatsApp number to ConvoReal today means the customer creates their own Meta app,
adds the WhatsApp product, generates a permanent access token, copies a Phone Number ID, and
configures a webhook by hand. That is the four-accordion walkthrough in
`src/components/settings/whatsapp-config.tsx:526-608`, plus a "do it for me" concierge escape hatch
(`src/app/api/whatsapp/setup-request/route.ts`) that exists precisely because the self-serve path
loses people.

For a brokerage owner this is days of elapsed time and a support conversation. Competitors selling
against us lead with onboarding speed.

### 1.2 What competitors do, and why we are not copying it

Products like loop2.ai advertise "No API. No new number. No templates. Live in 2 minutes." They
achieve this by registering as a **linked device** on the WhatsApp multi-device protocol — the same
slot WhatsApp Web occupies — via an unofficial client library. Because they act as the user's own
WhatsApp client, there is no WABA, no template approval, and no 24-hour window.

It also violates WhatsApp's Terms of Service. Numbers get banned with no appeal, sessions break
whenever the protocol shifts, and there is no CTWA attribution, no Flows, and no catalog. We are
not building this. Note that `integration_type` already carries an unimplemented `'web_qr'` value
(migration `068:7`, `src/types/index.ts:477`, a stub branch at `whatsapp-config.tsx:1212`) — that
value is a dead end and this plan does not extend it.

### 1.3 What Meta actually shipped

Two things make the official path competitive:

**Embedded Signup** — the customer clicks one button in ConvoReal, completes Meta's hosted flow in
a popup, and comes back with a WABA and a working phone number. No developer console, no token
copy-paste, no manual webhook config.

**Coexistence** — a feature type *inside* Embedded Signup, GA worldwide since May 2025. The
business scans a QR from their existing WhatsApp Business app and gets Cloud API on the **same
number** while continuing to use the app on their phone. Up to 180 days of 1:1 chat history and
their full contact list sync into our inbox, and messages they send from the app fire webhooks so
we can display them.

The decisive detail, from Meta's docs: *"Messages sent from the WhatsApp Business app are not
subject to the customer service window and do not create, extend, or affect Cloud API conversation
windows."* The human agent keeps free-form, unlimited, template-free messaging from their phone —
the exact capability competitors sell — while our automation runs under normal Cloud API rules on
the same number. This is the sanctioned version of the thing we are being undercut on.

**Timing that constrains planning:**

- Embedded Signup **v2 and v3 are deprecated 15 October 2026**. v4 is current. We have never built
  this, so we build v4 directly and skip the migration — but every third-party tutorial and sample
  repo you find is likely v2/v3 and already dead. Do not copy them.
- ISVs were required to enroll as **Tech Providers** by 30 June 2025 to keep offering WhatsApp.
  ConvoReal is an ISV offering WhatsApp to brokerages. **This is a business-status question that
  gates the entire project** — see §2.1.

### 1.4 Product decision

Offer **two** onboarding paths and retire nothing:

| Path | For | Result |
|---|---|---|
| **Coexistence** (recommended default) | A brokerage already running their business from the WhatsApp Business app | Same number, keeps the app, history + contacts import, Cloud API automation |
| **Embedded Signup (new number)** | A brokerage starting fresh, or one that wants a dedicated line | Clean WABA, API-only number, full throughput |
| Manual credentials (existing) | Self-hosters, Meta-savvy customers, anyone we cannot onboard under our own Tech Provider app | Unchanged — do not remove |

Sandbox (`integration_type = 'sandbox'`) is unaffected and stays as the pre-signup trial.

---

## 2. Founder checklist (not code — gates the launch, not the build)

### 2.1 Settle Tech Provider status FIRST

Embedded Signup requires Tech Provider or Solution Partner standing. Independent of this feature,
the ISV mandate may already apply to how we onboard customers today. **Confirm ConvoReal's current
standing with Meta before scoping engineering time.** If we are not enrolled, that enrollment —
including Business Verification — is the first task and everything below waits on it.

### 2.2 App Review for Advanced access

The app needs **Advanced access** to:

- `whatsapp_business_management` — customer WABA settings and message templates
- `whatsapp_business_messaging` — customer phone number settings, sending and receiving

Without Advanced access approval, **the permission does not appear in the Embedded Signup flow at
all** and customers cannot grant it. Requires a screencast of the flow plus Business Verification.
Budget weeks of calendar time. Everything in Phases A–D can be built and tested in dev mode
against our own test WABA before review passes.

### 2.3 Decide: same Meta app or a second one

We currently have two app identities in env: the WhatsApp app (`META_APP_SECRET`, used for webhook
HMAC) and the Ads app (`META_ADS_APP_ID` / `META_ADS_APP_SECRET`). Embedded Signup must run on the
**WhatsApp app**, because the webhook subscription and the HMAC signature must belong to the same
app that customers grant access to.

Recommendation: **same WhatsApp app**, new env vars so code does not have to care:

```
WHATSAPP_ESU_APP_ID=              # may equal the existing WhatsApp app id
WHATSAPP_ESU_APP_SECRET=          # may equal META_APP_SECRET
NEXT_PUBLIC_WHATSAPP_ESU_APP_ID=  # public, drives UI visibility
NEXT_PUBLIC_WHATSAPP_ESU_CONFIG_ID=       # Facebook Login for Business configuration id
NEXT_PUBLIC_WHATSAPP_ESU_COEX_CONFIG_ID=  # separate config id if Coexistence needs its own
WHATSAPP_ESU_ENABLED=true         # feature flag; all UI hides when unset
```

Mirror the `META_ADS_ENABLED` pattern (`src/app/api/meta-ads/oauth/start/route.ts:26-28`) so this
can merge and deploy before App Review completes.

### 2.4 Create the Facebook Login for Business configuration

Embedded Signup is driven by a **configuration ID** created in the app dashboard, not by a raw
scope list. Confirm at build time whether Coexistence needs a separate configuration from the
new-number flow, or whether one configuration covers both — the two env vars above assume separate;
collapse them if not.

### 2.5 Register the redirect URI

Not strictly required for the popup flow (which returns a code via `postMessage`, not a redirect),
but register `https://www.convoreal.com` and `https://convoreal.com` as valid OAuth redirect
domains anyway. Meta's strict-mode matching is character-for-character and treats www and non-www
as different hosts — a mismatch fails on Facebook's generic "URL Blocked" page with no server-side
error to debug from. This bit us on the Ads integration; see
`docs/meta-ads-integration-plan.md` §2.3.

### 2.6 Migration numbering

`supabase/migrations/` currently holds 234 files with a highest prefix of `213`, and roughly twenty
duplicated numbers (`063`, `073`, `078`, `092`, `103`, `110`, `115`, `126`, `151`, `154`, `166`,
`173`, `175`, `179`, `194`, `195`, `198`, `200`, `203`, `204`). This plan uses **`214`**. Re-list
the directory before writing the file — the count drifts.

---

## 3. What already exists (audit)

More of this is built than it looks. The Embedded Signup shape maps almost 1:1 onto existing code.

| Requirement | Already in the repo |
|---|---|
| Signed OAuth state + one-time nonce cookie | `src/lib/meta-ads/oauth-state.ts` — `signOAuthState` / `verifyOAuthState` / `generateNonce`, unit tested |
| Complete OAuth start → callback → encrypt → store flow to copy | `src/app/api/meta-ads/oauth/{start,callback}/route.ts`, including the account-mismatch replay guard at callback lines 74-84 |
| `POST /{phone_number_id}/register` | `src/lib/whatsapp/meta-api.ts:379` — already handles already-registered and Meta test-number cases |
| `POST /{waba_id}/subscribed_apps` | `src/lib/whatsapp/meta-api.ts:442`; read-back at `:474` |
| Token encryption at rest (AES-256-GCM) | `src/lib/whatsapp/encryption.ts` |
| Registration state tracking + diagnostics | Migration `015` (`registered_at`, `subscribed_apps_at`, `last_registration_error`); probe endpoint `src/app/api/whatsapp/config/verify-registration/route.ts` |
| Webhook → tenant routing by `phone_number_id` | `src/lib/whatsapp/webhook-handler.ts:360-379` — already the correct shape for one shared Meta app across many tenants, including the multi-match drop guard at `:373` |
| Template submission to Meta | `src/lib/whatsapp/meta-api.ts:799` (`submitMessageTemplate`), sample media upload at `:843` |
| Engine template definitions + gap detection | `src/lib/whatsapp/engine-templates.ts` — 7 builders in `ENGINE_TEMPLATES` plus `missingEngineTemplates()` |
| Auth + role gating + error mapping | `src/lib/auth/account.ts` — `requireRole`, `getCurrentAccount`, `toErrorResponse` |
| Rate limiting | `src/lib/rate-limit.ts` — `checkRateLimit` / `rateLimitResponse` |

**What is genuinely new:** the token-exchange call, the client-side Facebook JS SDK component, the
`postMessage` listener, and the Coexistence sync calls. Everything else is assembly.

### 3.1 Gaps in the current schema and routes

- `integration_type` CHECK is `('sandbox', 'web_qr', 'official_api')` — migration `068:7`. No value
  represents an Embedded Signup or Coexistence connection.
- No `business_id`, no `token_expires_at`, no record of *how* an account was onboarded.
- **Two-step PIN ownership inverts.** Today the PIN comes from user input and registration only
  runs when they typed one — `src/app/api/whatsapp/config/route.ts:289-290`
  (`const needsRegistration = hasPin`). Under Embedded Signup *we* generate, store and own the PIN.
- `UNIQUE(phone_number_id)` (migration `013`) plus `UNIQUE(account_id)` on `whatsapp_config` means
  strictly one number per account. Embedded Signup can return multiple phone numbers under one
  WABA, and the `FINISH` event carries a `waba_ids` array in the multi-WABA case. Punting is fine
  for v1 — but punt **deliberately**, and store the extra ids rather than dropping them.
- `POST /api/whatsapp/config` is built entirely around pasted credentials
  (`route.ts:182-192`). Do not overload it; add a sibling route (§5.2).
- `META_API_VERSION` is hardcoded `'v21.0'` in two places — `src/lib/whatsapp/meta-api.ts:12` and
  `src/lib/meta-ads/client.ts:15`. Verify v21 supports Embedded Signup v4 before assuming; bump
  both together if not.

### 3.2 CSP

`next.config.ts:46` already allows `https://connect.facebook.net` in `script-src` (the Showcase
Meta Pixel needs it), so the SDK loader is covered. But `frame-src` is `'self'
https://www.youtube-nocookie.com` only (`next.config.ts:59`), and the FB JS SDK plants a hidden
cross-domain-communication iframe on `www.facebook.com`. CSP is currently **report-only**, so this
will not block anything today — but it must be fixed before the flip to enforce, and the violation
will be noisy in the console meanwhile. Add `https://www.facebook.com` to `frame-src` as part of
Phase C.

---

## 4. Phase A — schema

### 4.1 Migration `214_whatsapp_embedded_signup.sql`

```sql
-- ============================================================
-- whatsapp_config: Embedded Signup + Coexistence onboarding
--
-- Why this exists:
--   Embedded Signup hands back a business_id and a business-scoped
--   token alongside the waba_id/phone_number_id we already store, and
--   the two-step PIN becomes OURS to generate rather than the user's
--   to type. Coexistence adds a second axis: the number is live on the
--   customer's WhatsApp Business app at the same time, which changes
--   throughput limits and which features are available.
--
--   Recording HOW an account was onboarded matters for support: a
--   Coexistence number that stops delivering has different causes than
--   a manually-configured one, and the history sync is a one-shot with
--   a 24-hour deadline that we need to be able to audit after the fact.
--
-- Backfill: every column is nullable or defaulted. Existing rows are
-- untouched and keep integration_type = 'official_api'.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_integration_type_check;

ALTER TABLE public.whatsapp_config
  ADD CONSTRAINT whatsapp_config_integration_type_check
  CHECK (integration_type IN (
    'sandbox',
    'web_qr',
    'official_api',
    'embedded_signup',
    'coexistence'
  ));

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS business_id TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS two_step_pin TEXT,
  ADD COLUMN IF NOT EXISTS onboarded_via TEXT
    CHECK (onboarded_via IS NULL OR onboarded_via IN ('manual', 'embedded_signup', 'coexistence')),
  ADD COLUMN IF NOT EXISTS esu_session_id TEXT,
  ADD COLUMN IF NOT EXISTS additional_waba_ids TEXT[],
  ADD COLUMN IF NOT EXISTS is_on_biz_app BOOLEAN,
  ADD COLUMN IF NOT EXISTS coex_contacts_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coex_history_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coex_sync_error TEXT;

COMMENT ON COLUMN public.whatsapp_config.two_step_pin IS
  'AES-256-GCM encrypted (src/lib/whatsapp/encryption.ts). Generated by us during Embedded Signup, never shown to the user. Needed to re-run POST /{phone_number_id}/register without re-onboarding.';
COMMENT ON COLUMN public.whatsapp_config.esu_session_id IS
  'Session id from the Embedded Signup postMessage payload. Meta support asks for this when a signup fails; keeping it makes those tickets answerable.';
COMMENT ON COLUMN public.whatsapp_config.coex_history_sync_at IS
  'Coexistence chat-history sync is a ONE-SHOT with a 24h deadline from onboarding. NULL after a coexistence onboarding means history was never imported and the customer must be offboarded and re-onboarded to get it.';
COMMENT ON COLUMN public.whatsapp_config.is_on_biz_app IS
  'Mirrors the Phone Number API is_on_biz_app field — true when the number is simultaneously live on the WhatsApp Business app. Drives the 20 mps throughput cap and the group-chat/disappearing-message limitations in the UI.';
```

No RLS changes: `whatsapp_config` policies are already account-scoped
(`RUN_IN_SUPABASE_SQL_EDITOR.sql:369-374`) and these are new columns on an existing table.

### 4.2 Type update

Extend `WhatsAppConfig` in `src/types/index.ts:465-484` with the new fields and widen
`integration_type` to `'sandbox' | 'web_qr' | 'official_api' | 'embedded_signup' | 'coexistence'`.
Then fix the two other places that narrow the same union:
`src/components/settings/whatsapp-config.tsx:67,131` and `src/lib/whatsapp/trial-check.ts:18`.
`npm run typecheck` will find them.

---

## 5. Phase B — server side

### 5.1 New lib: `src/lib/whatsapp/embedded-signup.ts`

```ts
export interface EmbeddedSignupSession {
  phoneNumberId: string
  wabaId: string
  businessId: string
  additionalWabaIds?: string[]
  sessionId?: string
}

export async function exchangeSignupCode(params: {
  code: string
  appId: string
  appSecret: string
}): Promise<{ accessToken: string; expiresIn: number | null }>

export function generateTwoStepPin(): string
```

Notes for the implementer:

- The exchange is a server-to-server call against Meta's OAuth token endpoint with `client_id`,
  `client_secret` and `code`. **Verify the exact endpoint and response shape against current
  docs** — `src/lib/meta-ads/client.ts` has a working analogue (`exchangeCodeForToken`) but it is a
  different app and a different token type, so copy the shape, not the URL.
- **The code has a 30-second TTL.** The client must POST it to us immediately. Do not stash it in
  React state, do not await anything else first, and do not retry a stale code — surface a
  "session expired, please try again" error instead.
- For Tech Providers the exchange yields a customer-scoped business token. These generally do not
  carry an expiry, but store `token_expires_at` when Meta returns one and treat NULL as
  "non-expiring" rather than "unknown".
- `generateTwoStepPin` must produce exactly 6 digits — the existing validator at
  `src/app/api/whatsapp/config/route.ts:194-201` is the contract. Use `crypto.randomInt`, not
  `Math.random`.

### 5.2 New route: `POST /api/whatsapp/embedded-signup/complete`

Gate with `requireRole('owner')` — same tier as the existing WhatsApp config and the Ads OAuth
start (`meta-ads/oauth/start/route.ts:34`). Rate-limit with `checkRateLimit` keyed on
`esu-complete:${accountId}`.

Body: `{ code, phone_number_id, waba_id, business_id, session_id?, waba_ids?, coexistence? }`.

Sequence:

1. Reject if `WHATSAPP_ESU_ENABLED !== 'true'` (404, mirroring the Ads flag check).
2. Service-role check that no other account already claims `phone_number_id` — reuse the logic at
   `config/route.ts:223-246` verbatim; under RLS the caller's session cannot see the conflict.
3. `exchangeSignupCode()` → business token.
4. `subscribeWabaToApp({ wabaId, accessToken })` — `meta-api.ts:442`. Sets `subscribed_apps_at`.
5. `generateTwoStepPin()`, then `registerPhoneNumber({ phoneNumberId, accessToken, pin })` —
   `meta-api.ts:379`. Sets `registered_at`. **Skip this step for Coexistence** (§7).
6. `verifyPhoneNumber()` — `meta-api.ts:266` — to confirm and to read `is_on_biz_app`.
7. Encrypt the token and the PIN with `encrypt()`, upsert `whatsapp_config` with
   `integration_type` and `onboarded_via` set to `'embedded_signup'` or `'coexistence'`.
8. Fire the template seed (§6) — do not block the response on it.

Keep the existing failure semantics: a save that succeeded but did not register returns 200 with
`{ success: false, saved: true, registered: false, registration_error }` so the UI can show a
specific remediation step (`config/route.ts:385-396`). Do not throw a 500 for a Meta-side failure
after the row is written.

**Never log the code, the token or the PIN** — AGENTS.md §2.5.

---

## 6. Phase C — client side

New component `src/components/settings/embedded-signup-button.tsx`, `"use client"`.

```ts
FB.login(callback, {
  config_id: process.env.NEXT_PUBLIC_WHATSAPP_ESU_CONFIG_ID,
  response_type: 'code',
  override_default_response_type: true,
  extras: { setup: {} },
})
```

Listen for `window.message` events where `type === 'WA_EMBEDDED_SIGNUP'`:

| `event` | Meaning | Action |
|---|---|---|
| `FINISH` | New-number signup complete | POST to `/complete` with `coexistence: false` |
| `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` | Coexistence complete | POST with `coexistence: true` |
| `FINISH_ONLY_WABA` | WABA shared, no phone number | Save the WABA, tell the user to add a number |
| `FINISH_OBO_MIGRATION` / `FINISH_GRANT_ONLY_API_ACCESS` | Out of scope for v1 | Log and show a "contact support" path |
| `CANCEL` | Abandoned or errored | Payload carries `current_step`, or `error_message`/`error_code`/`session_id`. Surface the message; keep the session id for support |

The success payload carries `{ phone_number_id, waba_id, business_id }` plus conditional
`ad_account_ids`, `page_ids`, `catalog_ids`, `instagram_account_ids`, `dataset_ids`, and `waba_ids`
in the multi-WABA case. **Verify these key names against current docs** — this is exactly the kind
of payload Meta reshapes between versions.

`event.origin` must be validated against Facebook's origin before trusting any payload — a
`message` listener without an origin check accepts messages from any frame.

Also in this phase: add `https://www.facebook.com` to `frame-src` in `next.config.ts:59` (§3.2).

Surface the button in `src/components/settings/whatsapp-config.tsx` inside the existing
"Integration Method" card (`:859`), and on the guided setup page
`src/app/(dashboard)/settings/whatsapp-setup/page.tsx`, above the manual accordion — not replacing
it.

---

## 7. Coexistence specifics

Coexistence is the same flow with a different configuration and a different completion event, but
the post-onboarding handling diverges enough to be worth its own section.

**Onboarding UX:** the customer enters the phone number registered on their WhatsApp Business app,
receives a verification code on WhatsApp, scans a QR from within the Business app, and consents to
share contacts and history.

**Do not call `/register`.** The number is already live. Calling `registerPhoneNumber` on a
Coexistence number is at best a no-op and at worst disruptive. Branch on the `coexistence` flag at
§5.2 step 5.

**The sync is a one-shot with a hard deadline.** Contacts and message history are requested via the
SMB App Data API. Per Meta: *"You have 24 hours to synchronize their messaging history, otherwise
they must be offboarded and they must complete the flow again."* History arrives in three phases
(day 0–1, day 1–90, day 90–180) covering up to 180 days of 1:1 messages plus roughly two weeks of
media. Record `coex_contacts_sync_at` / `coex_history_sync_at` and treat a NULL on either as a
support-visible warning, not a silent gap.

**Capability differences to reflect in the UI and in send-path guards:**

- Fixed throughput of **20 messages/second** for dual-use numbers. This is well below normal Cloud
  API tiers and matters for `broadcasts` — check the broadcast batching against it.
- **Group chats are not supported** on Cloud API.
- Disappearing messages, view-once messages and live location are disabled.
- Up to four companion devices (excluding Windows and WearOS).

**Billing and windows.** Messages the agent sends from the WhatsApp Business app stay free and are
*not* subject to the customer service window; messages we send via Cloud API are billed at Cloud
API rates and *are*. Critically, app-sent messages **do not create or extend the Cloud API
window** — so `isWithinCustomerWindow()` (`src/lib/whatsapp/customer-window.ts:16`) stays correct
as written and must **not** be relaxed for Coexistence accounts. An agent replying from their phone
does not open a free-form window for our automation. Get this wrong and sends fail at Meta with the
window error the module already knows how to detect.

**Inbound from the app.** Messages the agent sends from the Business app arrive as webhooks. Decide
deliberately how `webhook-handler.ts` records them — they are outbound-from-business but arrive on
the inbound path, and misfiling them will corrupt both the conversation view and any
last-customer-message bookkeeping the window check depends on.

---

## 8. Phase D — template auto-seeding

This is the cheapest win in the plan and the one that most directly answers "no templates."

`src/lib/whatsapp/engine-templates.ts` already defines seven engine templates with Meta-ready
payload builders, and `missingEngineTemplates()` already computes the gap against an account's
existing rows:

`property_enquiry_response`, `property_enquiry_photos`, `location_reveal`, `inventory_update`,
`property_enquiry_status`, `property_enquiry_update`, `buyer_alerts_consent`.

After a successful signup, loop `ENGINE_TEMPLATES` through `submitMessageTemplate()`
(`meta-api.ts:799`) with the new business token and the account's origin. Meta review typically
returns within minutes to hours, so a customer who finishes onboarding in the morning has an
approved template set the same day — instead of discovering a missing template at the moment a send
fails, which is the failure mode `engine-templates.ts` was written to fix.

Implementation notes:

- Run it **after** the response is returned. A template submission failure must not fail onboarding.
- Respect `WHATSAPP_TEMPLATES_DRY_RUN` — it exists precisely so this kind of bulk submission can be
  exercised without hitting Meta.
- Reuse the upsert row builder in `src/app/api/whatsapp/templates/submit/route.ts:28-70` rather
  than writing a second one; template rows carry both `account_id` and `user_id` and the unique
  index is on `(user_id, name, language)`.
- Seven submissions in a burst may trip Meta's rate limits. Sequence them with a small delay rather
  than `Promise.all`.

---

## 9. Testing

Unit (Vitest, no network — dummy secrets are stubbed in `vitest.config.ts`):

- `embedded-signup.test.ts` — `generateTwoStepPin` always returns 6 digits and passes the existing
  `/^\d{6}$/` validator; `exchangeSignupCode` maps Meta error shapes through
  `parseMetaErrorInfo` (`meta-api.ts:82`).
- Event-name → onboarding-path mapping, including the CANCEL branches.
- `customer-window.test.ts` — add a case asserting Coexistence does **not** relax the window.

Manual, against a test WABA in dev mode (before App Review):

1. New-number Embedded Signup end to end; confirm `registered_at` and `subscribed_apps_at` are set
   and `verify-registration` reports `live: true`.
2. Coexistence onboarding on a real Business-app number; confirm contacts and history land, and that
   the number still works from the phone.
3. Send from the phone → confirm the webhook arrives and is filed correctly.
4. Confirm free-form send from ConvoReal to a contact whose only recent message was answered from
   the phone still fails the window check (this is correct behaviour, not a bug).
5. Confirm the manual credentials path still works untouched.

---

## 10. Risks and open questions

| Risk | Handling |
|---|---|
| Tech Provider standing unresolved | **Blocks everything.** §2.1 — resolve before scoping. |
| App Review rejected or slow | Ship behind `WHATSAPP_ESU_ENABLED`; manual path stays live. |
| Meta reshapes the `postMessage` payload | Validate defensively; treat missing `phone_number_id`/`waba_id` as CANCEL rather than crashing. Log `session_id` always. |
| v21.0 too old for Embedded Signup v4 | Verify early (§3.1). Bumping `META_API_VERSION` touches both `meta-api.ts:12` and `meta-ads/client.ts:15` and needs a regression pass on the whole send path. |
| Coexistence 20 mps cap vs. broadcasts | Audit `src/app/api/whatsapp/broadcast/` batching before enabling Coexistence for accounts that broadcast heavily. |
| One-number-per-account assumption | `UNIQUE(account_id)` + `UNIQUE(phone_number_id)`. v1 keeps it; store `additional_waba_ids` so a future multi-number feature is not blind. |
| History sync 24h deadline missed | `coex_history_sync_at` NULL is a support-visible state, not a silent one. |

## 11. Sources

Verify against these at implementation time, not against this document:

- [Embedded Signup overview](https://developers.facebook.com/docs/whatsapp/embedded-signup)
- [Embedded Signup implementation (v4)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Onboard WhatsApp Business app users (Coexistence)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)

## 12. Non-goals

Parked deliberately, not forgotten: multi-number and multi-WABA per account; OBO migration
(`FINISH_OBO_MIGRATION`); Solution Partner credit line sharing; migrating existing manually
configured accounts onto our Tech Provider app; a self-serve offboarding flow; and any work on the
`web_qr` integration type, which stays a dead stub (§1.2).
