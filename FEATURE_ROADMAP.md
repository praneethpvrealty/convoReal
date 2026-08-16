# Feature Roadmap: Real Estate ConvoReal

This document outlines the product vision, active milestones, and future development cycles for the Real Estate ConvoReal platform.

---

## Product Vision

To build the definitive, WhatsApp-first Engine for independent real estate agencies and brokers. The platform combines conversational AI ingestion, smart contact-property matching, automated scheduling, and public showcase sites into a unified, multi-tenant portal.

---

## 🗺️ Product Roadmap

### Milestone 1: Expected Yield Matching & Location-Agnostic Profiling (DONE)

_Provide flexibility for investors who prioritize yields over location coordinates._

- [x] **Database Expansion**: Add `min_roi` NUMERIC field to `contacts`. (migration 048)
- [x] **UI Preferences**: Create expected min ROI number controls in Contact Forms and Preference Drawers. (`contact-form.tsx`, `contact-detail-view.tsx`)
- [x] **Matching Logic**: Filter properties so `property.roi >= contact.min_roi`. (`src/lib/matching.ts`)
- [x] **Location Agnosticism**: Allow contacts with empty areas or areas containing `'any'` to match properties in any sublocality. (`src/lib/matching.ts`)
- [x] **Scoring Adjustments**: Weight the ROI yield component in matching scoring calculations. (`src/lib/matching.ts`, covered by `matching.test.ts`)

---

### Milestone 2: Interactive Webhook Webflows & Automated Template Management (DONE)

_Reduce chat friction by migrating text conversations into structured WhatsApp buttons and selection flows._

- [x] **Meta Template Sync**: Auto-fetch approved templates from Meta Graph API to sync text layouts, headers, and media options. (`src/app/api/whatsapp/templates/sync/route.ts`)
- [x] **Interactive Buttons**: Replace textual confirmation steps in chatbot flows with Meta Cloud API Interactive Reply Buttons. (`src/lib/whatsapp/meta-api.ts`, used in `chatbot-engine.ts` and `flows/engine.ts`)
- [x] **WhatsApp Interactive Flows**: Buyers fill/update their budget and locality preferences directly inside WhatsApp using native Meta form-screen flows. Endpoint-backed: Flow JSON blueprint + prefill/response mapping (`src/lib/whatsapp/preference-flow.ts`), encrypted data-exchange endpoint with RSA-OAEP/AES-GCM handshake (`src/app/api/whatsapp/flows/endpoint/[accountId]/route.ts`, `src/lib/whatsapp/flow-crypto.ts`), Meta lifecycle (create/upload/publish + key registration) in `src/lib/whatsapp/meta-flow-service.ts`, `nfm_reply` webhook handling + "update my preferences" trigger in `webhook-handler.ts`. (migration 125)
- [x] **Outbound Broadcast Queue**: Implement dynamic retries with exponential backoffs for throttled or failed Meta Graph API outbound requests. (`src/lib/broadcasts/sender.ts:357-401`, migration 075)

---

### Milestone 3: AI PDF Brochures & Customer Analytics (Q4 2026)

_Empower agents to generate high-quality marketing collateral on the fly and track customer engagement._

- [ ] **AI Flyer Customization**: Support custom layout templates for AI-generated flyers (including typography, branding, and color palettes). Partial: `flyer-creator-dialog.tsx` has 3 fixed overlay templates + branding text fields, but no custom typography/color-palette controls.
- [ ] **Brochure Compiler**: Generate downloadable PDF property brochures containing highlights, specs, maps, and agent details. Not started.
- [ ] **Click Tracking**: Encode tracking tokens in shared links (`/showcase/prop-id?c=contact-id`) to notify agents via WhatsApp when a customer opens a listing. Partial: link tokens + open/view events are tracked (`src/lib/pulse/tracker.ts`), but no WhatsApp notification fires on open.
- [ ] **Client Interest Heatmap**: Display match interest scores based on page view durations and images clicked on the showcase portal. Partial: aggregate dwell-time/view-count stats exist (`src/lib/pulse/queries.ts`, `/pulse` page) but no per-contact interest score or true heatmap.

---

### Milestone 4: RERA Registry Integration & Real Estate Portal Sync (Q1 2027)

_Build trust and automate lead generation by integrating external listing platforms and official registries._

- [ ] **Automated RERA Checker**: Automatically check the `rera_projects` table and official state RERA portals when creating a property listing. Display a "RERA Verified" badge on listings. Note: `rera_projects` is currently populated with AI-generated/mocked data (`src/app/api/projects/sync`), not verified against real state registries — no "RERA Verified" badge field exists yet.
- [ ] **Multi-Portal Sync**: Integrate incoming webhooks or scrapers for listings added to MagicBricks, Housing.com, and 99acres, linking them to agent profiles. Note: only inbound _lead-email_ parsing from these portals exists (`src/app/api/leads/email-webhook/*`) — no listing sync.

  **Where this stands, and the cheapest route in.** Ad↔listing identity is now solved: an agent asserts a portal ad id against a listing once (`POST /api/contacts/[id]/portal-link`), and every later lead on that ad resolves exactly, before any scoring (`route.ts:609`). What is missing is _state_: when an ad expires, is edited, or is taken down, nothing tells the Engine — and nothing tells the portal when the listing changes here. There is no public listing API on any of the three portals, so neither direction can be a straight integration.

  Portal → Engine has two channels that already exist, neither of them wired:
  1. **The portals email every listing change.** That mail arrives in the same mailbox as the leads and is deliberately discarded — `checkIsNonLeadEmail()` (`route.ts:167`) matches `listing update` / `property alert` / `price drop` and drops it as "not a lead", which is correct for lead ingestion and wrong for this. The ingest path, IMAP sync, Cloudflare worker and per-account address all exist; what is needed is a second consumer that parses the ad id and updates the `property_portal_listings` row. Push, not poll, and no new integration surface.
  2. **The Chrome extension already harvests the portal dashboard.** `src/lib/portal-import/listing-parser.ts` turns a listing card into a `ParsedListing` that already carries `expiresOn`, `views`, `responses` and a status — and migration 124 already added `views`, `responses`, `last_refreshed_at` and `last_synced_at` to `property_portal_listings`, all currently unwritten. Pointing the harvester at _mapped_ ads rather than only at imports would fill them.

  Engine → portal cannot be automated at all: posting is a manual web form. The most it can be is the Engine noticing divergence and the extension pre-filling the edit.

  **The drift checks are done — they needed neither channel** (Aug 2026, migration 267). `portal_listing_drift()` computes all four kinds in SQL from leads and sync logs already on hand; `GET /api/portals/drift` serves them; a panel on the Inventory page (web) and the Properties tab (mobile) shows each finding with the facts that support it. Stateless by design: fixing the condition clears the row, so there is no dismissal state to go stale. The motivating example flags correctly — PROP-1083 `Archived` with its MagicBricks ad (85514527) still producing leads:
  - [x] mapped ad receiving leads while the listing is Archived or Sold — `withdrawn_stock`, an ad being paid for on withdrawn stock
  - [x] mapped ad past `expires_on` but still receiving leads — `stale_expiry`; the recorded expiry is stale, not the ad
  - [x] mapped ad with no leads well past `expires_on` — `likely_lapsed`; `src/lib/portals/expiry-reminders.ts` nudges but never learns the outcome, this notices it
  - [x] the ad's parsed type/price/area drifting from the listing's — `details_drift`, using the scorer's own tolerances, so a drift means the lead that mapped the ad would no longer look like it (PROP-1083's ad says Commercial Land; the listing is Residential Plot). `email_sync_logs` now carries the quoted ad id next to the parsed enquiry (backfilled from retro-tagged contacts by phone), which is what links "what the ad currently says" to the ad.

- [ ] **Suggest the listing an unmapped ad belongs to**: the unmapped-ads queue (migration 264, `/api/portals/unmapped-ads`) makes the agent find the listing themselves; it should propose it. `src/lib/portal-import/listing-matcher.ts` already scores an external listing against inventory and returns ranked candidates with human-readable reasons — built for the extension's import flow and used by nothing else. Feed it each ad's parsed details, which `email_sync_logs` already stores per lead (`parsed_property_type`, `parsed_location`, `parsed_area_sqft`, `parsed_price`, migration 200), and show the top candidate with its reasons for one-tap confirmation. Two constraints learned from mapping three ads by hand: **propose, never auto-map** — the assertion is the agent's — and **demote the matcher's type gate to a signal on this path**. A portal ad's category is whatever was typed into the portal, sometimes years ago; fed the Commercial Land ad against Residential Plot PROP-1083 the gate returns 0 and would never suggest the right listing, though project, area and price all matched exactly.
- [ ] **Make adding a portal a one-file change**: a fourth portal today is a 12+ file change including a migration. The half built in Aug 2026 is already portal-agnostic and comes free — the ad↔listing mapping and its one-to-one guarantee, the assert-once flow with its retro-tag sweep and conflict refusal, the unmapped-ads queue on both surfaces, exact resolution before scoring, and `contacts.lead_portal` / `lead_portal_listing_id`. None of it knows which portals exist.

  What is per-portal, and where it is pinned: the `PortalKey` union and `PORTALS` meta (`post-kit.ts`); `portalKeyFromSource()`, `ID_RE` and `LEAD_ID_RE` (`listing-identity.ts`); the source if/else chain (`email-parser.ts`); the `isPortalSender` domain regex (`route.ts:149`); the dashboard card parser (`portal-import/listing-parser.ts`); the extension content scripts; and roughly eight UI files naming the three.

  **The `CHECK (portal IN (…))` constraints are the sharpest edge** — migrations 121 and 124 (×2). A new portal's leads fail to insert with a constraint violation rather than degrading to "unknown portal", and it surfaces when the first lead arrives, not at deploy. Replacing them with a lookup table, or dropping them and validating in code against `PORTAL_KEYS`, is worth doing ahead of any other work here.

  Target shape: a registry of one module per portal exporting `{ key, label, senderPattern, leadIdPatterns, urlIdPatterns, parseLead, parseDashboardCard }`, with `PORTAL_KEYS` derived from it rather than hand-written. Adding a portal becomes one file plus one registry line.

  **Do this when a fourth portal is actually on the table, not before.** The three disagree in ways nobody would have predicted — 99acres labels nothing, MagicBricks writes the id mid-sentence after a comma, Housing's URLs carry a slug its emails never quote — so an interface designed without a fourth portal's real mail in hand will fit it badly. The `__fixtures__` folder is what should tell you the interface. Attribution already reads the sender, which is the one signal every portal has, so a new portal needs its domain added to one pattern rather than a new mechanism.

- [ ] **Duplicate Listing Checker**: Run semantic checks on titles, locations, and images to detect duplicate listings added by different agents.

---

### Milestone 5: Visual Pipelines & Financial Forecasting (Q2 2027)

_Turn matches into closed deals with a visual sales pipeline, commission management, and dashboard reporting._

- [x] **Visual Kanban Deals Board**: Drag and drop deals across pipeline stages (`Lead`, `Site Visit`, `Negotiation`, `Closed`). (`src/components/pipelines/pipeline-board.tsx`, @dnd-kit)
- [ ] **Brokerage & Commission Splits**: Track expected brokerage commissions, agent splits, and referrer payout splits. Partial: brokerage tracking (percent + amount) is built (migration 040), but agent-split/referrer-payout calculation is not.
- [ ] **Analytics Dashboard**: Graph monthly closed deal values, conversion rates per agent, and top-yielding marketing templates. Partial: `pipeline-analytics.tsx` shows per-pipeline totals only, no per-agent conversion rates or template performance.
- [ ] **Multi-Number Support**: Enable agencies to configure separate WhatsApp numbers for different agents, while maintaining tenant isolation. Blocked: `whatsapp_config` has a `UNIQUE(account_id)` constraint (migration 017); a `multi_number` billing-plan gate exists as a stub but nothing calls it yet.

---

### Milestone 6: Public API & MCP Access (Q3 2027)

_Let a workspace be reached from outside the app — by an AI client, an automation platform, or a partner script._

- [x] **Per-Account API Keys**: Long-lived, revocable, scoped (`read` / `write`) credentials for non-browser clients. Only the SHA-256 hash is stored; the plaintext is shown once. (migration 256, `src/lib/auth/api-keys.ts`, `src/app/api/account/api-keys/`)
- [x] **Versioned `/api/v1` Surface**: Fifteen account-scoped endpoints over inventory, contacts, matching, Match Radar, deals, agenda, notes, to-dos and the Portfolio rollups. Service-role client under explicit `account_id` scoping, the same posture as the Den and buyer portals. (`src/app/api/v1/`, `src/lib/v1/`)
- [x] **MCP Server**: Standalone stdio server exposing 16 tools to MCP clients such as Claude Desktop, including both directions of the matching engine. (`mcp/`)
- [x] **Portfolio Rollups**: Agency-side view of the owner and buyer portals — how much owner stock is still sellable and what it is worth, buyer budget distribution (average, median, range), bid and shortlist activity. SQL aggregates scoped through the account's own `den_contact_links` / `buyer_contact_links`, so a portal identity the account has not linked is unreachable. (migration 257, `src/lib/v1/portfolio.ts`, `src/app/api/v1/portfolio/`)
- [x] **API Keys Settings UI (web)**: Create, list and revoke keys from Settings → API Keys. Admin+ and Agency-plan gated, matching the server. The secret is shown once, read-only is the default, and revoked keys stay listed so the record survives. (`src/components/settings/api-keys-tab.tsx`)
- [ ] **API Keys Settings UI (mobile)**: Not built — a §2.8 gap, stated rather than silent. The mobile app has no account-administration surface at all today (no Members, Teams, Billing or Routing), so API keys would be the first of its kind and needs a Settings shell to live in rather than a one-off screen. Deferred with the rest of that surface.
- [ ] **Hosted Remote MCP**: OAuth 2.1 with dynamic client registration at `/api/mcp`, so a workspace can be connected without running a local process. Deliberately deferred until the stdio server shows real usage.
- [x] **Rate Limiting Across Instances**: `src/lib/rate-limit.ts` now counts in Redis when `REDIS_URL` is set, so one budget is shared by every serverless instance instead of one per instance. INCR and the expiry are a single Lua script; a Redis failure degrades to the in-process counter rather than removing the limit or 429-ing everything. `checkRateLimit()` became async and all 155 call sites were migrated. Without `REDIS_URL` the old in-memory behaviour is unchanged, so a self-hoster needs no Redis.
- [x] **Multi-Request Voice Notes & Teammate Updates**: A dictated note is no longer capped at one outcome. `parseEventsFromInput` returns every request the model found, and the WhatsApp owner path files each one, so "send Sharan the update on the Kusumaraju meeting, and remind me to follow up after a week" produces both a sent update and a to-do instead of only the to-do. The new `notify` intent delivers to a resolved teammate through `createNotification` (bell + push + their own WhatsApp) rather than writing a calendar row. (`src/lib/calendar/event-parse.ts`, `src/lib/calendar/whatsapp-scheduler.ts`, `teammate_update` in `src/lib/notifications/events.ts`)

---

### Milestone 7: Voice Agent Telephony (Planned — see `docs/voice-agent-integration-plan.md`)

_Answer and qualify phone leads with Sarvam Voice Agents — telephony is the one lead channel the platform does not cover today._

- [x] **Post-call webhook ingestion**: `POST /api/webhooks/voice-agent` find-or-creates the contact, journals the call (`contact_call_logs.source = 'voice_agent'`, idempotent on the provider's call id), stamps the inbox thread preview, and fires `new_contact_created` automations. (migration 269, `src/app/api/webhooks/voice-agent/route.ts`)
- [ ] **Per-account configuration**: `voice_agent_config` table + Settings → Integrations UI on web **and** mobile (§2.8), replacing the global `VOICE_AGENT_WEBHOOK_TOKEN` with per-account secrets. Not started.
- [x] **Qualification call campaigns**: broadcast-style outbound calls to a listing's enquirers ("is ₹14.7 Cr within your budget?") — recipients seeded from `contact_property_inquiries`, editable per campaign; stated budget/areas written back over the inferred ones and the contact retagged, so matching can propose alternatives. Server side: migration 270, `src/app/api/voice-campaigns/`, `/api/cron/voice-campaigns` dispatcher, `src/lib/voice/` with a provider-pluggable dialer (`VOICE_CALL_PROVIDER=custom` routes calls to any HTTP bridge as a Sarvam outage/pricing hedge) and webhook writeback with opt-out + Qualified/Budget Mismatch tags. UI on both surfaces (§2.8): web as the "Voice Calls" tab on `/broadcasts` (`voice-campaigns-content.tsx`), mobile under More → Marketing (`mobile/app/(app)/voice-campaigns.tsx` + `voice-campaign/[id].tsx`, shared logic in `mobile/lib/voice-campaigns.ts`). Credit-gated per dial attempt (`voice_campaign_call` = 25 cr, auto-refunded when the call never connects — `docs/credits-policy-voice-campaign-call.md`), price disclosed on both surfaces. One stated sub-gap: editing an existing campaign's `agent_ref` is web-only (the mobile detail screen says so inline).
- [x] **Audio announcements + reminder channel preference**: announcements as WhatsApp audio inside the 24-hour window, as a TTS video-header template outside it (no audio template format exists — reuses the listing-video TTS/ffmpeg pipeline), or as a call; `contacts.preferred_update_channel` chooses per contact, editable web + mobile (§2.8). Partial: migration 271, the preference field + contact-form controls on both surfaces, the worker TTS→opus generation pipeline (`src/lib/voice/announcement-worker.ts`, 5 cr per render, refunded on failure), and the create/list/send APIs (`src/app/api/announcements/`) with preference- and window-aware per-recipient dispatch through the inbox-persisting sender. Announcements UI ships on both surfaces: the "Announcements" tab on `/broadcasts` (web) and More → Marketing → Audio announcements (mobile) — create with language picker and price disclosure, generation status, preference-aware send with per-run result summaries (audio preview web-only). Closed-window path shipped: the worker packages each note as an mp4 (migration 273) and sends fall back to the `audio_announcement_notice` VIDEO-header engine template for audio-channel recipients once approved (`video_template` count; `skipped_window` until then). Reply-button capture shipped: `POST /api/contacts/[id]/ask-update-channel` + `updch:*` control replies set the preference from a tap, reachable from the contact form on both surfaces. Reminder calls shipped with Phase B (contacts preferring calls get appointment reminders as voice-agent calls, WhatsApp fallback on any failure). Reminder audio shipped: the reminder cron queues a per-reminder TTS job (`src/lib/voice/reminder-audio.ts` + `-worker.ts`, migration 276 opt-in on the Voice settings card, 2 cr per note refunded when it never lands) for audio-preferring contacts with an open 24-hour window, spoken in the contact's language, template fallback on every failure path.
- [x] **Per-account voice configuration (Phase B)**: `voice_agent_config` (migration 274) — per-account webhook token (global env token now a deprecation fallback), default `agent_ref` used by campaigns and reminder calls, active + reminder-call opt-ins; Settings → WhatsApp → Voice card on web (`voice-agent-card.tsx`, `/api/voice-config`). Mobile settings surface is a stated §2.8 gap with the other account-admin screens. Appointment reminders honour `voice_call` preference via `src/lib/voice/reminder-call.ts` (charged per attempt, refunded on start failure, WhatsApp fallback).
- [x] **Voice preference intake → matching (Phase E)**: the webhook's `requirement` block carries the stated budget range (`budget_min`/`budget_max`) onto the contact, and every call that states a requirement fires `generateMatchEventForContact` — the same Match Radar hook the public requirements form uses — so phone-only leads flow into ranking, Radar events and the existing digests with no agent typing.
- [x] **Post-call WhatsApp follow-up** (built — `docs/post-call-followup-plan.md`): what the lead receives after a call ends, decided by an explicit `disposition` the agent reports (or derived from the qualification block). Playbooks are `(flow_kind, disposition) → actions` in pure TS (`src/lib/outreach/playbooks.ts`), dispatched through one gate (`src/lib/outreach/dispatcher.ts`: opt-outs, window state, `canSendToEveryLead()`, dedupe, skip reasons recorded). One Utility opener template (`post_call_options`, engine template in all 7 languages) whose quick-reply tap opens the 24-hour window; the matched-listing shortlist rides free-form behind it. `outreach_followups` (migration 281) carries dated re-engagement for `not_now`, swept hourly by `/api/cron/outreach-followups`. Flow-agnostic: owner onboarding is a second `flow_kind` awaiting only a playbook. Server-side feature — no UI surface, so §2.8 does not bite.
- [x] **Call analytics**: the "Call Analytics" tab on `/broadcasts` — volume/connect-rate/duration tiles, calls-per-day chart, outcome split, disposition table with follow-up sent/opened counts, and the follow-up funnel with visible skip reasons. SECURITY DEFINER RPCs (migration 282) behind `GET /api/calls/analytics`. Mobile gap stated below.

---

### Deferred: dictating a teammate update from web or mobile

_A §2.8 gap, stated rather than silent._

- [ ] **Notify intent in Smart Add (web + mobile)**: Speaking or typing "tell Sharan the visit is off" sends the update only through the WhatsApp owner chatbot. The _receiving_ half is already at full parity — `createNotification` fans out to the in-app bell on web, Expo push on mobile, and the teammate's own WhatsApp, and the new `teammate_update` toggle ships in Settings → Notifications on both surfaces. What is missing is the sending half in Smart Add (`src/components/calendar/smart-add-bar.tsx`, `mobile/components/voice-scheduler.tsx`): both render one confirm card built around a date, a contact and a property, with no recipient field and no send action. `/api/ai/parse-event` therefore downgrades a `notify` draft to a `task`, so the request lands on the speaker's own list rather than vanishing. Closing it means a recipient row on the confirm card and a route that performs the send.

### Deferred: attaching a plan to a rent-roll row on mobile

_A §2.8 gap, stated rather than silent._

- [ ] **Rent-roll floor plan attach (mobile)**: `floor_tenancies` rows carry an optional `floor_plan` image (migration 285), and the web form offers an Attach/Replace control on each tenancy row. Mobile's rent-roll editor round-trips the field but has no attach button, so a plan can only be pinned there from web. The capability itself is at parity: the standalone **Floor Plans** editor — which covers every property type, commercial included — ships on both surfaces, and mobile never wipes a plan set on web. Closing this is one picker call on the tenancy card in `mobile/app/(app)/property-edit.tsx`, reusing `mobile/components/property-floor-plans.tsx`.

### Deferred: account administration on mobile

_§2.8 gaps, stated rather than silent. They share one root cause: the mobile app has no account-administration surface at all (no Members, Teams, Billing, Routing or Settings shell), so each of these would be the first of its kind rather than a screen added to an existing section._

- [ ] **Owner details request wording (mobile)**: The per-account editor for the seller intake message ships on web only (Settings → WhatsApp → Owners). The _message itself_ is at full parity — the mobile sheet reads the same saved wording through `GET /api/owners/details-request/settings` and sends through the same route — so an account that customises it on web sees the change on the phone immediately. Only the editing UI is missing. (migration 262, `src/components/settings/owner-details-request-card.tsx`)
- [ ] **API Keys Settings UI (mobile)**: See Milestone 6. Same root cause, same deferral.
- [ ] **Call Analytics UI (mobile)**: the Call Analytics tab (Milestone 7) ships on web only. The logic is fully mobile-reachable — `GET /api/calls/analytics` is a bearer-auth API route returning the whole camelCase bundle — so closing the gap is one screen consuming it; there is no mobile analytics/chart surface yet to add it to.

---

### Deferred: portal posting on mobile

_A §2.8 gap, stated rather than silent._

- [ ] **Portal ad ids on mobile** (`src/components/inventory/portal-post-dialog.tsx`, the `99 / MB / H` badges in `src/components/inventory/property-list.tsx`): recording where a listing is advertised, and the portal's own ad id for it, ships on web only. Mobile has no portal surface at all — posting is a copy-paste flow into the portals' own web forms, assisted by the Chrome extension, so the dialog grew where the work happens. What _is_ at parity is the part that matters for lead accuracy: the unmapped-ads queue and the one-tap assertion from a lead both run on the phone (`mobile/components/unmapped-portal-ads.tsx`), reading the same `unmapped_portal_ads` and `POST /api/contacts/[id]/portal-link`. So an agent can map every ad from mobile; they just cannot see or edit the ad id from the listing itself. Closing it means a read-only portal section on the mobile property screen, plus the ad-id editor.

---

### Deferred: follow-up radar, layers 2 and 3

_The shipped slice (auto-heat + the daily WhatsApp follow-up card, `src/lib/contacts/auto-heat.ts` and `src/lib/contacts/follow-up-nudges.ts`) covers detection and the agency-side reminder. What it deliberately does not do yet:_

- [ ] **Commitment capture**: a lead's own callback promise ("we can talk whenever", "will call you Monday") should create a follow-up to-do with a parsed due date — the machinery exists in `handleClientFollowupReply` and `event-parse.ts`, it is just never triggered from an inbound lead message. Until then such a lead is only caught by the generic 48h-silence radar.
- [ ] **Automatic client check-ins**: today the bot only messages the lead when the agent taps 💬 Check in on the card. A per-account opt-in could let the radar check in on its own after N quiet days, under the same caps (one per lead per week, stop after two unanswered, honours STOP).
- [ ] **Escalation to the owner**: a card the assigned agent leaves untouched for 48h should notify the account owner. Needs per-card action tracking on `follow_up_nudges`.
