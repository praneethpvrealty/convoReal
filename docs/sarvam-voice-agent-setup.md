# Sarvam voice agent — setup

How to connect a Sarvam voice agent to ConvoReal's qualification call
campaigns and reminder calls. The application side ships already
(`docs/voice-agent-integration-plan.md`); this is the provider side —
what to create in Sarvam's console, and the two contracts that have to
match for results to land back on the contact.

Sarvam is the default provider, not a requirement: everything below has
a `custom` equivalent (`VOICE_CALL_PROVIDER=custom`), and the webhook
contract in §3 is what any provider must satisfy.

---

## 0. What you need first

| Thing                            | Where                           | Notes                                                                                                                                                                             |
| -------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sarvam account with Voice Agents | `indus.sarvam.ai/samvaad`       | The Voice Agents console — separate section from the API usage dashboard                                                                                                          |
| `SARVAM_API_KEY`                 | Vercel env                      | The same key the listing-video and announcement TTS already use; if Bulbul is billing, this is set                                                                                |
| An outbound phone number         | Sarvam → Deploy → Phone numbers | Outbound calls need a number attached to the agent. Sarvam also integrates telephony providers (Exotel, Plivo) — either way the number lives on the Sarvam side, not in ConvoReal |
| Credits in the ConvoReal wallet  | Header pill                     | 25 cr per connected call. A 15-recipient campaign at 3 attempts is at most 1,125 cr, and unanswered attempts are refunded                                                         |

Two bills, not one: Sarvam charges you for telephony and model usage,
ConvoReal charges the account's credit wallet per connected call.

---

## 1. Create the agent

Sarvam → **Build → Agents**. The **Real Estate Lead Qualification**
starter matches the qualification-call use case; start there and edit
rather than writing an agent from scratch.

ConvoReal passes these variables with every campaign dial. Reference
them in the agent's prompt using Sarvam's variable syntax:

| Variable         | Example                              | Source                                                                    |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `contact_name`   | `Gopi`                               | The contact row; empty string when unknown                                |
| `campaign_id`    | `6f0e…`                              | The campaign — **must be echoed back** (§3)                               |
| `property_title` | `Old House in Koramangala 1st Block` | The listing the campaign is about                                         |
| `asking_price`   | `147000000`                          | Raw rupees, unformatted — have the agent say "14.7 crore", not the digits |
| `locality`       | `Koramangala 1st Block`              | Listing sublocality, falling back to location                             |

Reminder calls (Settings → WhatsApp → Voice → _Appointment reminders as
calls_) pass a different set to the same agent: `contact_name`,
`appointment_title`, `appointment_time`, `location`, `brand_name`.

A starting prompt for the qualification job — the point of the call is
to find out whether the enquiry was budget-real, and if not, what the
person actually wants:

```
You are calling on behalf of {{brand_name}} about a property enquiry.

The person is {{contact_name}}. They enquired about {{property_title}}
in {{locality}}, which is priced at {{asking_price}} rupees — say this
as a natural Indian figure ("fourteen point seven crore"), never digit
by digit.

Your job, in this order:
1. Confirm you are speaking to the right person, and that they did
   enquire about this property.
2. Tell them the asking price plainly and ask whether that works for
   their budget.
3. If it does not, find out what does: their budget range, which
   localities they are looking in, and what kind of property.
4. Ask whether they want to be shown alternatives that fit.
5. If they ask not to be called again, acknowledge it and end politely.

Be brief and respectful — this is a cold follow-up to a web enquiry,
not a sales pitch. Speak whichever of English, Hindi or Kannada the
person answers in. Never invent details about the property beyond the
title, locality and price above; if asked something you do not know,
say an agent will follow up on WhatsApp.
```

Take the agent id from the console once saved — that is the
`agent_ref` ConvoReal dials.

---

## 2. Point ConvoReal at the agent

**Settings → WhatsApp → Voice** (web):

1. **Default voice agent id** — paste the agent id. Campaigns with no
   agent of their own fall back to this, as do reminder calls.
2. **Voice agent active** — on.
3. Copy the **post-call webhook URL**. It looks like:
   `https://convoreal.com/api/webhooks/voice-agent?token=<per-account token>&account_id=<account uuid>`
   The token is this account's credential; rotate it there if it leaks.
4. Optionally enable **reminders as calls** and **reminders as voice
   notes** — both are per-account opt-ins with their own credit cost.

A campaign cannot be activated with no agent id anywhere: the API
rejects it rather than dialling into nothing.

---

## 3. Configure the post-call webhook (the contract that matters)

On the agent, set the end-of-call/post-call webhook to `POST` the URL
from §2. This is the only path by which anything a caller says reaches
the Engine, and **`caller_phone` is the one field it cannot work
without** — a payload lacking it is rejected.

```json
{
  "call_id": "{{call_id}}",
  "caller_phone": "{{phone_number}}",
  "caller_name": "{{contact_name}}",
  "direction": "outbound",
  "outcome": "connected",
  "duration_seconds": 92,
  "called_at": "2026-08-14T11:05:00Z",
  "language": "en-IN",
  "summary": "Enquired on the 14.7 Cr Koramangala house; budget is 8-9 Cr, looking at HSR and Sarjapur, wants alternatives.",
  "transcript": "{{transcript}}",
  "campaign_id": "{{campaign_id}}",
  "callback_requested": false,
  "requirement": {
    "text": "4 BHK, ready to move",
    "budget_min": 80000000,
    "budget_max": 90000000,
    "areas": ["HSR Layout", "Sarjapur Road"],
    "property_interest": "4 BHK villa"
  },
  "qualification": {
    "budget_confirmed": false,
    "stated_budget": 90000000,
    "stated_areas": ["HSR Layout"],
    "wants_alternatives": true,
    "do_not_call": false
  }
}
```

Field notes, all enforced server-side:

- **`outcome`** must be one of `connected`, `no_answer`, `busy`,
  `voicemail`, `wrong_number`, `callback_requested`. Anything else is
  read as `connected`. `callback_requested: true` promotes a
  `connected` outcome to `callback_requested`.
- **`campaign_id`** is what resolves the recipient row. Echo the
  variable back verbatim. Without it the contact still gets their call
  log, tags and requirement, but the campaign never marks the recipient
  done — it redials them after the two-hour stale sweep.
- **Money is in rupees, not lakhs or crores.** `90000000` is 9 Cr.
  `budget_min`/`budget_max` land on the contact's preference fields and
  feed matching directly.
- **`qualification.budget_confirmed`** drives tagging: `true` tags the
  contact **Qualified**, `false` tags them **Budget Mismatch**, and
  omitting it tags nothing.
- **`qualification.do_not_call: true`** opts the recipient out of the
  campaign and sets `do_not_call` on the contact. Honour it.
- Unanswered outcomes (`no_answer`, `busy`) refund the call's credits
  automatically.

Everything else is optional — send what the agent reliably extracts and
leave the rest out rather than guessing. A summary and transcript are
worth sending: both land on the contact's call log where an agent reads
them.

---

## 4. Environment variables

| Variable                    | Value                   | Why                                                       |
| --------------------------- | ----------------------- | --------------------------------------------------------- |
| `SARVAM_API_KEY`            | your key                | Dialling and TTS both use it                              |
| `VOICE_CALL_PROVIDER`       | `sarvam` (default)      | `custom` to switch providers without a code change        |
| `SARVAM_OUTBOUND_CALL_PATH` | see below               | Override if the API path differs from the default         |
| `VOICE_CALLS_DRY_RUN`       | `true` while rehearsing | Short-circuits dialling with a synthetic call id          |
| `VOICE_AGENT_WEBHOOK_TOKEN` | optional                | Legacy global token; per-account tokens (§2) supersede it |

**Verify the outbound-call path before the first real dial.** ConvoReal
posts `{agent_id, phone_number, variables}` to
`https://api.sarvam.ai/v1/voice-agents/calls` by default, with the
`api-subscription-key` header. Sarvam's Voice Agents API is newly GA
and the path is not pinned in this repo by anything authoritative —
check **Deploy → Deploy with code** in the console, and if it differs,
set `SARVAM_OUTBOUND_CALL_PATH` rather than editing code. A wrong path
shows up as `HTTP 404` in the dispatcher logs with the attempt refunded,
not as a silent failure.

---

## 5. Rehearse, then go live

1. Set `VOICE_CALLS_DRY_RUN=true`. Start a campaign with one or two
   recipients. The dispatcher (every 10 minutes, inside the campaign's
   IST call window) claims and "dials" them, burning and logging as it
   would live.
2. POST the §3 payload to your webhook URL by hand, with the
   `campaign_id` of that campaign and the `caller_phone` of the
   recipient. Confirm on the contact: a call log with summary and
   transcript, the requirement fields, the **Qualified** or **Budget
   Mismatch** tag, and a Match Radar event if a requirement was stated.
   Confirm on the campaign: the recipient leaves `calling`.
3. Turn dry-run off, keep the campaign small, and watch the first live
   run before queueing the rest.

Calls only go out inside the campaign's IST window, so a campaign
started at 21:00 does nothing until the next morning. That is the
intended behaviour, not a stall.

---

## 6. When something does not land

| Symptom                                         | Cause                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Recipients stay `queued`, nothing dials         | Outside the IST call window; campaign not `active`; no agent id on campaign or account       |
| Recipients stick at `calling`, then redial      | The webhook is not firing, or is firing without `campaign_id`                                |
| `401` from the webhook                          | Token in the URL does not match the account's; recopy from Settings, or check it was rotated |
| `503` from the webhook                          | No credential exists at all — no per-account config and no env token                         |
| Call log appears, campaign does not advance     | `campaign_id` missing or not matching a recipient for that contact                           |
| `HTTP 404` in dispatcher logs, credits refunded | Wrong `SARVAM_OUTBOUND_CALL_PATH`                                                            |
| Contact created with no requirement             | The agent sent no `requirement` block, or sent budgets in crores instead of rupees           |
