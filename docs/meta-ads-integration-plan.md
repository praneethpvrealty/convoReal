# Meta Ads (Click-to-WhatsApp) Integration — Design & Implementation Plan

> **For the implementing model:** This is a complete design. Implement in phase order (A → D);
> each phase is independently shippable and verifiable. Read `AGENTS.md` first — this repo runs
> a breaking-changes Next.js 16; consult `node_modules/next/dist/docs/` before writing route/page
> code. Do NOT run DDL against the database — write migration files only; the owner applies them
> manually via the Supabase SQL editor. Do not commit; the owner commits. After every phase:
> `npx tsc --noEmit`, `npx eslint <touched files>`, `npx vitest run` — all must be clean.
> Where this doc specifies Graph API field names, treat them as the design intent and verify the
> exact spelling against current Meta Marketing API docs at implementation time rather than
> trusting either this doc or training data blindly — Meta renames things.

---

## 1. Product decision (why this shape)

We are NOT building a general-purpose ads manager. We are building **property promotion via
Click-to-WhatsApp ads (CTWA)**: agent picks a property → AI writes the ad from the listing →
ad runs on Instagram/Facebook with "Send WhatsApp message" as the CTA → the buyer's first message
lands in the agent's existing ConvoReal inbox → the webhook auto-creates the contact, links the
property, and attributes the lead to the ad. The differentiated value is the **closed loop**
(ad → chat → contact → property → cost-per-lead), which Meta's own Ads Manager cannot do because
it doesn't own the CRM side.

**Why CTWA and not Lead Ads / traffic ads:** the destination is the agent's WhatsApp **business
number — already connected to our webhook** (`whatsapp_config`). Zero new lead-capture
infrastructure; the entire existing pipeline (find-or-create contact, property matching, routing,
Hot Leads) applies unchanged. Meta attaches a `referral` object to the first inbound message of an
ad-originated thread — that's our attribution hook.

**Non-goals for this project** (parked, see §12): Lead Ads instant forms, Conversions API,
Custom Audiences/retargeting, the "managed spend" agency model, A/B testing UI, Advantage+
audiences tuning.

---

## 2. Founder checklist (Praneeth, not code — gates the launch, not the build)

1. **Meta App Review**: the Meta app needs Advanced Access to `ads_management`, `ads_read`,
   `business_management`, `pages_show_list`, `instagram_basic`. Requires screencast of the flow +
   ConvoReal **Business Verification**. Budget 3–6 weeks calendar time. Everything below can be
   built and tested in **dev mode against your own ad account** before review passes.
2. Decide: reuse the existing WABA Meta app or a second app. Recommendation: **same app** (one
   review relationship, one secret), with new env vars so code doesn't care:
   `META_ADS_APP_ID`, `META_ADS_APP_SECRET` (may equal existing), `NEXT_PUBLIC_META_ADS_APP_ID`.
3. Register OAuth redirect URI: `https://<domain>/api/meta-ads/oauth/callback` (plus localhost for
   dev). `<domain>` must match, character-for-character, whatever `NEXT_PUBLIC_APP_URL` (or its
   `NEXT_PUBLIC_SITE_URL` fallback — see `src/app/api/meta-ads/oauth/start/route.ts`) resolves to in
   that environment. For this deployment that's `https://www.convoreal.com` — register
   `https://www.convoreal.com/api/meta-ads/oauth/callback` **and**
   `https://convoreal.com/api/meta-ads/oauth/callback` (both www and non-www) unless you're certain
   only one form is ever used, since Meta's "Use Strict Mode for redirect URIs" does an exact string
   match and treats the www/non-www forms as different hosts — a mismatch here fails silently with
   Facebook's generic "URL Blocked" page and no server-side error to debug from.
4. Feature flag: `META_ADS_ENABLED=true` env — all UI surfaces hide when unset, so this can merge
   and deploy before app review completes.
5. **Migration numbering**: `103` is currently DUPLICATED (`103_razorpay_orders.sql` and
   `103_update_starter_limits.sql`). Renumber one to `104` first. This plan's migrations are
   numbered **105–107** assuming that fix.

---

## 3. Phase A — CTWA attribution in the webhook (ship first; no Meta review needed)

**Value:** any CTWA ad — including ones agents already run manually via Instagram's Boost button —
gets auto-attributed in ConvoReal from day one.

### 3.1 Migration `105_ctwa_referrals.sql`

```sql
CREATE TABLE IF NOT EXISTS ctwa_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id TEXT,                -- Meta message id of the first inbound message
  source_type TEXT,               -- 'ad' | 'post'
  source_id TEXT,                 -- the ad id (joins to ad_campaigns.ad_id when we created the ad)
  source_url TEXT,
  headline TEXT,
  body TEXT,
  media_type TEXT,
  image_url TEXT,
  video_url TEXT,
  ctwa_clid TEXT,                 -- click id (needed later for Conversions API)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ctwa_referrals_account ON ctwa_referrals(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctwa_referrals_contact ON ctwa_referrals(contact_id);
CREATE INDEX IF NOT EXISTS idx_ctwa_referrals_source ON ctwa_referrals(account_id, source_id);
ALTER TABLE ctwa_referrals ENABLE ROW LEVEL SECURITY;
-- service-role only (same stance as public_listing_submissions): no policies; all access via API routes.
```

### 3.2 Webhook changes — `src/lib/whatsapp/webhook-handler.ts`

- Extend `WhatsAppMessage` (defined ~line 30 in the same file) with:
  ```ts
  referral?: {
    source_url?: string; source_id?: string; source_type?: string;
    headline?: string; body?: string; media_type?: string;
    image_url?: string; video_url?: string; ctwa_clid?: string;
  }
  ```
- Add a `processCtwaReferral()` step inside `handleIncomingMessage`, **right after the message
  insert succeeds and before `flagBroadcastReplyIfAny`** (mirror how `processListingVerification`
  was wired in — additive branch, no behavior change when absent). Logic:
  1. `if (!message.referral?.source_id && !message.referral?.ctwa_clid) return;`
  2. Insert `ctwa_referrals` row (best-effort, try/catch, never blocks message processing).
  3. Stamp the contact — only *upgrade* generic values, never overwrite meaningful ones
     (same philosophy as the property-code matcher at ~line 718):
     - `source`: set to `'meta_ctwa_ad'` only if currently null/empty.
     - `referrer`: set to `Instagram/Facebook Ad — "{headline}"` only if currently null.
     - `classification`: `'Buyer'` only if currently `'Others'`/null.
  4. **Property linkage:** look up `ad_campaigns` (Phase C table) by `ad_id = referral.source_id`
     for this account. If found → set `last_inquired_property_id` + `status='pending_review'`
     exactly like the existing title/code matcher does. (Before Phase C ships this lookup simply
     finds nothing — fine.) Note the existing text matcher may ALSO fire if the ad headline
     contains the property title; referral-based linkage should run FIRST and the text matcher
     skipped when it succeeds, to avoid double writes.
- The `referral` object arrives **only on the first message** of an ad-originated thread — no
  dedup worries, but don't assume it repeats.

### 3.3 UI surfacing (small)

- Contact detail (`src/components/contacts/contact-detail-view.tsx`): if the contact has a
  `ctwa_referrals` row, render a chip: `📣 Via Instagram/Facebook ad — "{headline}"` with date.
  Fetch via a new lightweight authed endpoint `GET /api/contacts/[id]/attribution` or fold into
  an existing contact-detail fetch — implementer's choice, keep it one query.
- Inbox conversation header: same chip, conditionally.

### 3.4 Tests (Phase A)

- Unit-test the referral extraction/stamping decision logic as pure functions (extract into
  `src/lib/whatsapp/ctwa-attribution.ts` so it's testable without the webhook harness):
  fixtures for: ad referral with all fields, referral with only `ctwa_clid`, no referral,
  contact already classified (no overwrite), ad_id matches campaign (property linked).

---

## 4. Phase B — Meta connect (OAuth) + config storage

### 4.1 Migration `106_meta_ads_config.sql`

```sql
CREATE TABLE IF NOT EXISTS meta_ads_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,       -- long-lived user token, AES-GCM encrypted via src/lib/whatsapp/encryption.ts
  token_expires_at TIMESTAMPTZ,     -- ~60 days from exchange; null if Meta returns none
  fb_user_id TEXT,
  ad_account_id TEXT,               -- 'act_...' id chosen by the user
  page_id TEXT,                     -- FB Page used as ad identity (must be the page linked to their WABA ideally)
  ig_account_id TEXT,               -- optional; ads can run on IG via page-backed identity without it
  currency TEXT,                    -- from ad account, e.g. 'INR' (display only)
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','token_expired','disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE meta_ads_config ENABLE ROW LEVEL SECURITY;  -- no policies; service-role via API routes only
```

### 4.2 Routes (all under `src/app/api/meta-ads/`)

| Route | Auth | Behavior |
|---|---|---|
| `GET /api/meta-ads/config` | `requireRole('viewer')` | Connection status + chosen assets. **Never returns the token.** |
| `GET /api/meta-ads/oauth/start` | `requireRole('owner')` | 302 to `https://www.facebook.com/vXX.X/dialog/oauth` with `client_id`, `redirect_uri`, `scope=ads_management,ads_read,business_management,pages_show_list,instagram_basic`, and `state` = HMAC-signed `{accountId, nonce, ts}` (sign with `META_ADS_APP_SECRET`; also set nonce in an httpOnly cookie — verify both on callback). |
| `GET /api/meta-ads/oauth/callback` | session (owner) | Verify state+nonce → exchange `code` → short token → long-lived (`grant_type=fb_exchange_token`) → encrypt+upsert `meta_ads_config` → fetch `/me/adaccounts?fields=id,name,currency,account_status` and `/me/accounts?fields=id,name,instagram_business_account` → if exactly one of each, auto-select; else redirect to `settings?tab=ads&select=1`. |
| `POST /api/meta-ads/config/select` | `requireRole('owner')` | Persist chosen `ad_account_id` / `page_id` / `ig_account_id`. Validate the ids belong to the token by re-fetching, don't trust the client. |
| `POST /api/meta-ads/disconnect` | `requireRole('owner')` | Best-effort `DELETE /me/permissions`, then set `status='disconnected'` and null the token. Keep the row + `ad_campaigns` history. |

**Graph client:** new `src/lib/meta-ads/client.ts` — thin fetch wrapper reusing
`META_API_VERSION` from `src/lib/whatsapp/meta-api.ts` and mirroring its friendly error-mapping
style (that file already maps Meta error codes to actionable user messages — same pattern, ads
vocabulary). All Meta calls are server-side only. Decrypt tokens with the existing
`decrypt()`; on Meta auth errors (`code 190`) set `status='token_expired'`.

### 4.3 Settings UI — new "Ads" tab

`src/app/(dashboard)/settings/page.tsx` tab list (~line 120): add
`{ value: 'ads', label: 'Ads', icon: Megaphone }` between `whatsapp` and `templates`, rendering a
new `src/components/settings/meta-ads-tab.tsx`:

- **Disconnected:** explainer card ("Run Instagram & Facebook ads for your properties; buyers land
  directly in your WhatsApp inbox") + `Connect Meta account` button → `/api/meta-ads/oauth/start`.
  Note under the button: "Ad spend is billed by Meta to your own card. ConvoReal never charges
  for ad delivery."
- **Connected, unselected assets:** two dropdowns (ad account, Page — show IG handle if the page
  has one) + Save.
- **Connected:** status card (green pill, ad account name/currency, page name, connected date) +
  Disconnect (confirm dialog).
- **token_expired:** amber banner + Reconnect button (same OAuth start).
- Whole tab renders an upsell state when plan is `starter` (see §7) and hides entirely when
  `META_ADS_ENABLED` is unset.

---

## 5. Phase C — "Promote this property" (campaign creation)

### 5.1 Migration `107_ad_campaigns.sql`

```sql
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,       -- Meta ids (strings)
  adset_id TEXT,
  ad_id TEXT,
  creative_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED','ERROR')),
  daily_budget_minor INTEGER NOT NULL,   -- paise (Meta minor units)
  currency TEXT NOT NULL DEFAULT 'INR',
  headline TEXT,
  primary_text TEXT,
  image_url TEXT,                  -- which listing photo was used
  radius_km INTEGER,
  end_at TIMESTAMPTZ,              -- optional scheduled stop
  created_by UUID,                 -- user_id
  last_insights JSONB,             -- cached: {spend, impressions, reach, conversations, fetched_at}
  last_insights_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_account ON ad_campaigns(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_ad_id ON ad_campaigns(account_id, ad_id);
-- one live campaign per property at a time (product decision — keeps the UX simple):
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_campaigns_one_active_per_property
  ON ad_campaigns(property_id) WHERE status IN ('ACTIVE','PAUSED');
ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;  -- no policies; API routes only
```

### 5.2 AI ad copy — `POST /api/ai/ad-copy`

- `requireRole('agent')`, plan-gated (§7), **`gatedBurn`-style hard credit gate** (owner-initiated
  feature → hard block at zero credits, consistent with credit-gating-design).
- Add to `AI_FEATURE_COSTS` in `src/lib/credits/types.ts`: `ad_copy: 10`.
- Input `{ property_id }` → load property → Gemini (`generateText`) with a system prompt that
  outputs strict JSON: `{ primary_text (≤125 chars), headline (≤40 chars), description (≤30 chars) }`
  — lengths matter, Meta truncates. Prompt rules: no discriminatory language (housing!), no
  ALL-CAPS, no phone numbers in copy (CTA button is the contact path), mention location + 1–2
  strongest features + price band, end with a soft CTA ("Message us on WhatsApp for details").
- Return copy for the user to edit — never auto-launch with unreviewed AI text.

### 5.3 Campaign creation — `POST /api/meta-ads/campaigns`

Input: `{ property_id, daily_budget_inr, duration_days?, radius_km, headline, primary_text, image_url }`.
Server steps (each Meta call via `client.ts`; on any failure, best-effort delete the objects
already created, mark nothing locally, return the mapped error):

1. Gates: `requireRole('agent')`, plan gate, `meta_ads_config.status='connected'` with selected
   `ad_account_id` + `page_id`, property belongs to account and has ≥1 image, no existing
   ACTIVE/PAUSED campaign for the property (unique index also enforces).
2. **Image**: `POST /act_{ad}/adimages` with the chosen listing photo (fetch bytes server-side
   from the Supabase public URL) → `image_hash`.
3. **Campaign**: `POST /act_{ad}/campaigns` — `{ name: "ConvoReal – {property_code} – {title}",
   objective: 'OUTCOME_ENGAGEMENT', special_ad_categories: [], status: 'PAUSED' }`.
   (`special_ad_categories: ['HOUSING']` only if ad-account country requires it — US/CA; for
   India-targeted ads pass `[]`. Leave a code comment; do not hardcode away the field.)
4. **Ad set**: `POST /act_{ad}/adsets` — `{ campaign_id, destination_type: 'WHATSAPP',
   optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS',
   daily_budget: <paise>, bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
   promoted_object: { page_id }, targeting: { geo_locations: … , age_min: 22 },
   status: 'PAUSED', end_time?: now+duration_days }`.
   Targeting: if the property has `latitude`/`longitude` (migration 093), use
   `custom_locations: [{ latitude, longitude, radius: radius_km, distance_unit: 'kilometer' }]`;
   else fall back to the property's city. Placements: omit (Advantage+ automatic).
   **The Page must have WhatsApp connected** (the agent's WABA number linked to that Page) —
   surface Meta's error clearly if not: "Your Facebook Page isn't linked to your WhatsApp number.
   Link it in Meta Business settings and retry."
5. **Creative**: `POST /act_{ad}/adcreatives` — `object_story_spec` with `page_id`
   (+ `instagram_actor_id` if `ig_account_id` set), `link_data: { message: primary_text,
   name: headline, image_hash, link: <wa.me link for the business number>,
   call_to_action: { type: 'WHATSAPP_MESSAGE' } }`.
6. **Ad**: `POST /act_{ad}/ads` `{ adset_id, creative: {creative_id}, status: 'PAUSED' }`.
7. Insert `ad_campaigns` row (status `PAUSED`), then — final step — flip campaign to `ACTIVE`
   via `POST /{campaign_id}` `{ status: 'ACTIVE' }` and update local status. Creating everything
   PAUSED and activating last means a mid-sequence failure never leaves a silently spending ad.

### 5.4 Promote UI — `src/components/inventory/promote-property-dialog.tsx`

Entry points: a `Megaphone` "Promote" action on the property list row + inside the property
detail/form (near the existing share/flyer actions — mirror how `flyer-creator-dialog.tsx` is
launched). Three steps in one dialog (state machine, not routes):

1. **Creative** — image picker (property photos grid, first preselected), "Generate with AI"
   button (calls `/api/ai/ad-copy`, shows credit cost like other AI buttons), editable
   `primary_text` (125-char counter) + `headline` (40-char counter), and a live **Instagram feed
   mock preview** (page avatar/name placeholder, image, primary text, "Send WhatsApp message"
   button) — sell the dream, dark-theme styling like the showcase components.
2. **Audience & budget** — radius slider 2–50 km ("around this property" when coordinates exist,
   else city notice), daily budget input (₹ whole rupees, min ₹200, suggest ₹300–500 chips),
   duration chips (7/14/30 days/ongoing). Copy: "Billed by Meta to your card — ConvoReal doesn't
   charge for ad delivery."
3. **Review & launch** — summary card, total est. spend (budget × days), policy checkbox
   ("My ad follows housing-ad rules — no discrimination"), Launch button → creates → success
   state with "View in Ads dashboard" link.

Not connected → the dialog renders a connect prompt linking to `settings?tab=ads`.
Starter plan → upsell state (§7).

---

## 6. Phase D — Ads dashboard

New page `src/app/(dashboard)/ads/page.tsx` (+ sidebar nav item, `Megaphone` icon, hidden without
`META_ADS_ENABLED`).

- `GET /api/meta-ads/campaigns` — lists `ad_campaigns` for the account; for rows whose
  `last_insights_at` is older than **15 minutes**, batch-refresh via one Insights call per stale
  campaign (`GET /{campaign_id}/insights?fields=spend,impressions,reach,actions`), extract
  conversations from `actions` where `action_type='onsite_conversion.messaging_conversation_started_7d'`,
  cache into `last_insights`. Serve cached data on Meta failure (stale-while-error) with a
  `stale: true` flag.
- **Leads column is ours, not Meta's**: `COUNT(ctwa_referrals WHERE source_id = ad_id)` — real
  contacts created, joined per campaign. Cost/lead = spend ÷ that count. Label the Meta metric
  "Chats started (Meta)" and ours "Leads in CRM" — never conflate them.
- Table per campaign: property thumbnail+title, status pill + pause/resume toggle
  (`PATCH /api/meta-ads/campaigns/[id]` `{ action: 'pause'|'resume' }` → Meta status flip + local),
  daily budget (inline edit → `{ action: 'set_budget', daily_budget_inr }`), spend, reach,
  chats started, **Leads in CRM** (click → contacts filtered to those leads), cost/lead,
  created date. Row menu: "Stop & archive" (Meta ARCHIVED + local), "View property".
- Banners: `token_expired` → reconnect CTA; empty state → marketing copy + "Promote your first
  property" button.
- All management routes: `requireRole('agent')`, campaign row must belong to `ctx.accountId`.

---

## 7. Plan gating & credits

- **Plan gate:** Meta Ads is a **Solo Pro+** feature. Reuse the existing mechanism in
  `src/lib/billing/gates.ts` (the `'AI features require Solo Pro or higher'` pattern, ~line 71):
  add a `meta_ads` check helper; `starter` gets `gateResponse(...)` from the API routes and an
  upsell card in UI surfaces ("Promote properties on Instagram — upgrade to Solo Pro").
- **Credits:** only the AI copy generation burns credits (`ad_copy: 10`, hard-gated). Campaign
  CRUD and insights are free — the agent already pays Meta for delivery; charging credits for
  API calls would feel like double-billing and discourage the loop we want.
- **Refund-policy touchpoint:** add one sentence to §6 of `/refund-policy` (WhatsApp/Meta
  charges): ad spend is billed by Meta directly to the agent's card and is outside ConvoReal
  billing entirely. (Config lives in `src/config/refund-policy.ts` page — keep the single-source
  pattern.)

## 8. Security & multi-tenancy invariants

- Tokens: AES-GCM encrypted at rest (existing `encryption.ts`); decrypted only server-side;
  never in any API response, log line, or client bundle. Scrub Meta error bodies before
  returning to the client (they can echo tokens in rare cases).
- OAuth `state`: HMAC over `{accountId, nonce, ts}` + httpOnly nonce cookie; reject >10 min old.
- Every Meta object id we act on (`campaign_id` etc.) is looked up from OUR row scoped by
  `ctx.accountId` — never accept raw Meta ids from the client for mutations.
- RLS: all three new tables service-role only (no policies), consistent with
  `public_listing_submissions`.
- Rate limits: Marketing API has per-ad-account budgets; the 15-min insights cache is the main
  guard. On `code 17` (rate limit) responses, serve cache and back off.

## 9. Testing & verification plan

- **Pure-function units** (vitest, no mocks of Meta needed): referral extraction/stamping rules
  (Phase A), OAuth state sign/verify, budget ₹→paise conversion, insights `actions` extraction,
  ad-copy JSON parsing/length clamps.
- **Route tests with a mocked `client.ts`**: campaign-create happy path, mid-sequence Meta
  failure → cleanup + no local row, duplicate-active-campaign rejection, token-expired mapping.
- **Manual E2E in dev mode** (own ad account, before app review): connect flow, create a
  campaign end-to-end and confirm objects in Ads Manager (leave PAUSED — comment out the final
  activate step or use a ₹200 budget and pause immediately), pause/resume/budget from dashboard.
- **Webhook attribution E2E**: replay a captured CTWA webhook payload (signed with
  `META_APP_SECRET` per `webhook-signature.ts`) against local `/api/whatsapp/webhook`; verify
  `ctwa_referrals` row + contact stamping + property link.
- Feature-flag off → zero UI/API surface changes (assert nav + settings tabs unchanged).

## 10. New/touched files summary

**New:** migrations `105–107`; `src/lib/meta-ads/client.ts`; `src/lib/whatsapp/ctwa-attribution.ts`
(+ test); `src/app/api/meta-ads/{config,oauth/start,oauth/callback,config/select,disconnect,campaigns,campaigns/[id]}/route.ts`;
`src/app/api/ai/ad-copy/route.ts`; `src/components/settings/meta-ads-tab.tsx`;
`src/components/inventory/promote-property-dialog.tsx`; `src/app/(dashboard)/ads/page.tsx`.

**Touched:** `webhook-handler.ts` (referral type + one additive call);
`src/lib/credits/types.ts` (`ad_copy` cost); `src/lib/billing/gates.ts` (meta_ads gate);
settings page (tab entry); property list/form (Promote button); sidebar nav (Ads);
contact-detail-view + inbox header (attribution chip); refund-policy page (one sentence).

## 11. Explicit sequencing for the implementing model

1. Phase A alone → typecheck/lint/tests → STOP for owner review (it touches the production
   webhook path; smallest possible diff).
2. Phase B → verify connect flow renders (feature-flagged) → STOP.
3. Phase C, then D. UI verification via the preview tooling against `localhost:3000`.
4. Never apply SQL; hand migrations to the owner. Never commit; the owner commits per phase.

## 12. Parked (explicitly out of scope now)

Conversions API using stored `ctwa_clid` (better ad optimization); Custom Audiences from contact
segments (needs hashing + Meta ToS acceptance); Lead Ads instant forms as second source;
managed-spend agency model (ConvoReal fronts spend, bills credits — revisit only with proven
demand; liability + GST pass-through + Meta agency rules); multi-property carousel ads;
budget recommendations from historical cost-per-lead.

## 13. Open decisions for Praneeth (answer before Phase B)

1. Same Meta app as WABA or separate? (Plan assumes same.)
2. Launch ads ACTIVE immediately after wizard, or default PAUSED with explicit go-live? (Plan
   assumes ACTIVE after the review step; flip one constant to change.)
3. Minimum plan: Solo Pro+ (assumed) or Team+?
4. One-active-campaign-per-property (assumed) or allow multiple?
