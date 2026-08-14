# Voice Agent (Sarvam) Integration — Design & Implementation Plan

> **For the implementing model:** This is a phased design. Phase A is implemented in this repo
> (webhook + migration 269); phases B–D are design intent. Read `AGENTS.md` first — this repo runs
> a breaking-changes Next.js 16. Do NOT run DDL against the database — write migration files only;
> the owner applies them manually via the Supabase SQL editor. Where this doc names Sarvam
> dashboard concepts or API fields, verify against current Sarvam docs
> (https://docs.sarvam.ai/conversations/overview) at implementation time — the platform (formerly
> "Samvaad") went GA in August 2026 and its surface is still moving. After every phase:
> `npm run typecheck && npm run lint && npm test` — all must be clean.

---

## 1. Product decision (why this shape)

We are NOT rebuilding conversational AI on a new channel. ConvoReal already owns WhatsApp
end-to-end — Meta Cloud API pipeline, chatbot engine, automations, flows, the 24-hour window
bookkeeping. What ConvoReal does not cover at all is **telephony**, and Indian real-estate leads
still arrive heavily by phone: portal listings, flyers, boards, and the public SEO pages
(`/property/[slug]`) all show a number that today rings an agent's personal phone or nobody.

Sarvam Voice Agents (GA since August 2026, 10 Indian languages + English, telephony/SIP managed
by Sarvam) fills exactly that gap. The account relationship already exists — `SARVAM_API_KEY`
powers translate + TTS for listing videos (`src/lib/video/listing-video-worker.ts`).

**The shape:** the voice agent lives on Sarvam's platform; ConvoReal is the system of record it
reports into. The agent answers (or places) a call, qualifies the caller in their language, and
posts a structured post-call payload to a ConvoReal webhook. ConvoReal find-or-creates the
contact, journals the call, surfaces it in the inbox, and lets the existing machinery (matching,
Match Radar, automations, Hot Leads) take over. The differentiated value is the same closed loop
as CTWA ads: **call → contact → property match → deal**, which a bare voice-agent platform
cannot do because it does not own the Engine side.

**Non-goals** (parked, see §9): routing WhatsApp through Sarvam, live call transfer to agents,
in-app softphone/dialer, call recording ingestion from Sarvam (the existing recording-analysis
path in migration 195 stays manual-upload).

---

## 2. Founder checklist (Praneeth, not code)

1. **Sarvam workspace**: create a Voice Agents workspace at the Sarvam dashboard
   (links.sarvam.io/Voiceagents) under the same account as the existing `SARVAM_API_KEY`.
   Confirm whether Voice Agents usage bills against the same subscription key or needs a
   separate credential — record the answer in `docs/external-services-audit.md`.
2. **Phone number**: provision one inbound number through Sarvam's managed telephony for the
   pilot brokerage. Per-tenant numbers are Phase B; the pilot proves lead quality first.
3. **Agent script**: author the qualification agent in the dashboard — greet, capture name,
   requirement (type / locality / budget), and whether a callback is wanted. Configure its
   post-call webhook / tool-call to `POST https://<domain>/api/webhooks/voice-agent` with the
   query params in §4. The agent's LLM should emit the structured `requirement` object itself;
   ConvoReal deliberately does not re-parse transcripts in Phase A.
4. **Secret**: generate `VOICE_AGENT_WEBHOOK_TOKEN` (`openssl rand -hex 32`), set it in Vercel,
   and paste it into the agent's webhook URL. The endpoint fails closed without it.
5. **Apply migration 269** in the Supabase SQL editor before pointing a live agent at the
   webhook — the insert names the new `source` / `external_call_id` columns.
6. `docs/external-services-audit.md`: add Sarvam Voice Agents (tier, per-minute cost, limits)
   next to the existing Sarvam TTS entry before launch.

---

## 3. Phase A — post-call webhook ingestion (implemented)

**Value:** every call the agent handles becomes a ConvoReal contact with a journaled call, with
zero new UI. Call rows surface in the existing per-contact call journal
(`contact_call_logs`, migration 076/195) and the thread preview surfaces in the inbox.

### 3.1 Migration `269_voice_agent_call_logs.sql`

Adds to `contact_call_logs`:

- `source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice_agent'))` — tells
  webhook-written rows apart from hand-logged ones.
- `external_call_id TEXT` — Sarvam's call id; unique per account when present
  (`idx_call_logs_external_call`), so a retried webhook delivery returns `duplicate` instead of
  journaling the call twice.

No new table, so RLS/policies are inherited from 076/195 unchanged.

### 3.2 Endpoint `POST /api/webhooks/voice-agent`

`src/app/api/webhooks/voice-agent/route.ts`. Same posture as `/api/leads/email-webhook`:

- **Auth**: `?token=` compared timing-safe against `VOICE_AGENT_WEBHOOK_TOKEN`; 503 (fail
  closed) when the env is unset, 401 on mismatch. `?account_id=` names the tenant; it must
  resolve to a profile or the request is rejected — there is no first-tenant fallback.
- **Rate limit**: 60/min per IP via `src/lib/rate-limit.ts`.
- **Service-role client** (`supabaseAdmin()`) with explicit `account_id` scoping on every query,
  per §2.6 of `AGENTS.md`.

Processing:

1. Parse the payload (§4); reject without a caller phone (400) or with an unnormalisable one
   (422 — `normalizePhoneWithCountryCode`).
2. `findOrCreateContact` (`src/lib/contacts/find-or-create.ts`) — phone-deduped, source
   `Voice Agent`, classification `Buyer`, status `pending_review`; budget / areas / mapped
   property interest applied. An ASR-mangled or placeholder name is replaced with
   `placeholderLeadName('Voice Agent')` → "Voice Agent Lead", never greeted verbatim.
3. Insert the `contact_call_logs` row (`source: 'voice_agent'`, transcript/summary in the
   migration-195 columns, requirement text + language in `notes`). A unique-violation on
   `external_call_id` returns `{status:'duplicate'}` with 200 so the provider stops retrying.
4. `resolveConversation` and stamp the thread preview
   (`📞 Voice Agent call (…): …`, `awaiting_reply: true`). Deliberately **no**
   `last_customer_message_at` — a phone call does not open Meta's 24-hour window.
5. New contacts fire the `new_contact_created` automation trigger, so existing welcome /
   routing automations apply to phone leads unchanged.

### 3.3 What Phase A deliberately does not do

- No outbound WhatsApp to the caller (the email-webhook auto-reply pattern). A phone caller has
  not messaged on WhatsApp; templated outreach to them is a Phase B decision with opt-in
  captured on the call.
- No transcript re-parsing. The voice agent's LLM owns extraction; ConvoReal trusts the
  structured `requirement` and stores the transcript for audit.

---

## 4. Webhook contract

```
POST /api/webhooks/voice-agent?token=<VOICE_AGENT_WEBHOOK_TOKEN>&account_id=<uuid>
Content-Type: application/json
```

```json
{
  "call_id": "sarvam-call-8f2c…",
  "direction": "inbound",
  "caller_phone": "+91 98765 43210",
  "caller_name": "Ravi Kumar",
  "language": "kn-IN",
  "called_at": "2026-08-14T09:30:00Z",
  "duration_seconds": 184,
  "outcome": "connected",
  "callback_requested": true,
  "summary": "Buyer looking for a 3 BHK flat in Whitefield under 1.2 Cr, wants a callback.",
  "transcript": "…",
  "requirement": {
    "text": "3 BHK in Whitefield under 1.2Cr",
    "budget_max": 12000000,
    "areas": ["Whitefield"],
    "property_interest": "Flat/ Apartment"
  }
}
```

Only `caller_phone` is required. `outcome` must be one of the `contact_call_logs` CHECK values
(`connected`, `no_answer`, `busy`, `voicemail`, `wrong_number`, `callback_requested`); anything
else is stored as `connected`. `callback_requested: true` upgrades a `connected` outcome to
`callback_requested`. `requirement.property_interest` is free text mapped through the same
`interestFromTypeText()` the portal-email path uses, so voice and email leads land on identical
interest labels. Field caps: transcript 20k chars, summary/requirement text 2k, 10 areas.

Responses: `{status:'created'|'updated', contactId, callLogId}`, `{status:'duplicate',
contactId}` on an already-journaled `call_id`, standard `{error}` otherwise.

---

## 5. Phase B — per-account configuration

Phase A's single global token + query-param tenant works for the pilot but is not multi-tenant
product. Phase B:

- Migration: `voice_agent_config` (standard §7.2 columns) — per-account webhook secret,
  Sarvam agent id, provisioned phone number, `is_active`, language defaults, and an opt-in flag
  for post-call WhatsApp follow-up (template send, MARKETING-gated per §2.7).
- Route change: resolve the tenant by per-account secret instead of the shared env token;
  keep the env token as a deprecation fallback for one release.
- Settings UI under Settings → Integrations, **web and mobile in the same change** (§2.8).
- `docs/external-services-audit.md` and `.env.local.example` updated accordingly.

## 6. Phase C — qualification call campaigns

**The driving case:** a Koramangala listing at ₹14.7 Cr pulled a large batch of Housing
enquiries of which ~95% were unqualified on budget. The email webhook already files every one
of those leads with the enquired property attached (`contact_property_inquiries`,
`last_inquired_property_id`) and the listing price as inferred budget (`pref_budget_max`).
What is missing is the second tier: calling each lead to ask "you enquired about X at
₹14.7 Cr — is that within your budget? If not, what are you actually looking for?" — done
today by hand, one call at a time.

Phase C makes that a **broadcast-style outbound call campaign**:

- **Migrations**: `voice_campaigns` + `voice_campaign_recipients` (standard §7.2 columns),
  mirroring the `broadcasts` / `broadcast_recipients` split. A campaign names the property it
  is about, the script variables (property title, asking price, locality), and per-recipient
  status (`queued` → `calling` → `completed` / `no_answer` / `failed` / `opted_out`) with an
  attempt counter.
- **Recipient selection**: seed from `contact_property_inquiries` for the chosen property —
  the Koramangala batch is one click — then add/remove individually, and reuse the broadcast
  audience patterns (`src/components/broadcasts/step2-select-audience.tsx` currently offers
  all/tags/custom-field/CSV; this adds an "enquired about property" source, which the broadcast
  wizard should gain at the same time). Recipients stay editable until the campaign starts, and
  removable while it runs.
- **Dispatch**: a cron walks `queued` recipients within calling hours (default 10:00–19:00
  IST), triggers a Sarvam outbound call per recipient with the campaign's context variables,
  and throttles to a per-account concurrency cap. Retries `no_answer`/`busy` up to N attempts
  across days, then parks the recipient.
- **Writeback**: results arrive through the Phase A webhook (`direction: 'outbound'`), extended
  with optional `campaign_id` and a `qualification` block:
  `{budget_confirmed, stated_budget, stated_areas, wants_alternatives}`. A confirmed budget
  tags the contact `Qualified`; a mismatch replaces the inferred `pref_budget_max` with the
  stated `max_budget` (stated-beats-inferred, the email webhook's existing convention), retags
  the budget band, and — because preferences are now real — `src/lib/matching.ts` and Match
  Radar can immediately propose alternative inventory the agent actually has.
- **Guardrails**: these are callbacks to people who enquired first, but every script must
  offer "don't call me again" → `opted_out` sets a do-not-call flag respected by all future
  campaigns; credit-gate per connected call (`docs/credits-policy-listing-video.md` is the
  model) since per-minute telephony has real cost.

The appointment-reminder call ("your site visit is tomorrow at 11 — confirm?") is the same
dispatch machinery with the appointments cron (`/api/appointments/cron`) as the trigger instead
of a campaign; it ships on top of Phase C once the channel preference below exists.

## 7. Phase D — audio announcements on WhatsApp + per-contact channel preference

**The ask:** plain announcements delivered as a voice recording on WhatsApp, with each contact
choosing how they want reminders/updates — audio message, text, or a call.

**The Meta constraint that shapes this:** template headers are TEXT / IMAGE / VIDEO / DOCUMENT
only (`src/lib/whatsapp/template-components.ts`) — there is **no audio template format**, so a
voice note cannot open a conversation outside the 24-hour window. Three delivery paths, picked
per recipient at send time:

1. **Inside the 24-hour window** (contact messaged recently): send a real audio message —
   `sendMedia` in `src/lib/whatsapp/meta-api.ts` already supports `kind: 'audio'`; the
   broadcast sender gains an audio-message branch that checks `customer-window.ts` first.
2. **Outside the window**: package the announcement as a **video template header** — the
   announcement script through the existing Sarvam translate + TTS pipeline
   (`src/lib/video/listing-video-worker.ts` already does exactly this for listing narration)
   over a branded still card via the same ffmpeg worker. Video is an accepted header format,
   so the "audio" announcement rides a normal MARKETING/UTILITY template and plays with one
   tap. This is a reuse of shipped machinery, not a new media pipeline.
3. **Voice call**: for contacts who prefer being called, route the announcement through the
   Phase C dispatcher as a one-off campaign.

**Channel preference**: `contacts.preferred_update_channel`
(`'whatsapp_text' | 'whatsapp_audio' | 'voice_call'`, default text) captured with interactive
reply buttons or the existing preference flow, editable from the contact drawer on web and
mobile (§2.8). The appointment-reminder cron, digests, and announcement broadcasts all consult
it before choosing a path.

## 8. Phase E — voice preference intake → matching

Promote the qualification script to full preference intake mirroring the WhatsApp preference
flow (`src/lib/whatsapp/preference-flow.ts`): structured budget/locality/type answers land on
the contact's preference fields, which `src/lib/matching.ts` and Match Radar consume with no
further work. Success metric: a phone-only lead receives a property-alert digest without an
agent ever typing their requirement.

## 9. Non-goals and boundaries

- **No WhatsApp via Sarvam.** Sarvam's WhatsApp channel is enterprise-on-request and would put
  a second bot on a WABA number ConvoReal's inbox, window bookkeeping, and chatbot engine
  already own. Telephony only.
- **No voice-agent surface on `/api/v1`.** The v1/MCP boundary excludes WhatsApp-sending and
  billing for the reasons in `mcp/README.md`; outbound calling is the same class of hazard.
- **No live transfer / softphone.** If a caller demands a human, the agent promises a callback
  (`outcome: 'callback_requested'`) and the inbox thread's `awaiting_reply` flag carries it.

## 10. Validation

- `npm run typecheck && npm run lint && npm test` (Phase A ships
  `src/app/api/webhooks/voice-agent/route.test.ts`).
- Manual: `curl -X POST '<domain>/api/webhooks/voice-agent?token=…&account_id=…' -d @sample.json
-H 'content-type: application/json'` twice with the same `call_id` — second response must be
  `duplicate`; contact appears once, in `pending_review`, with one call-journal row.
