# Credit Policy: Voice Campaign Call (Sarvam-backed)

## Raw cost per connected call

A qualification call (docs/voice-agent-integration-plan.md §6) consumes:

| Item                | Typical usage               | Notes                                                                        |
| ------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| Voice-agent minutes | ~2–3 min per connected call | ₹4.50/min on Sarvam's pay-as-you-go plan (₹4.00 on Business, ₹3.50 on Scale) |
| Telephony           | same minutes                | ₹0.40/min on every plan                                                      |
| Phone number        | ₹159/month                  | flat rental, not per call                                                    |
| Unanswered attempt  | ~0                          | no connection, no meaningful telephony cost                                  |
| Webhook processing  | negligible                  | own infra                                                                    |

Measured raw cost per connected call: **₹9.80–14.70** — ₹4.90/min
all-in over a 2–3 minute qualification call, read off Sarvam's
published pricing (indus.sarvam.ai/samvaad/pricing, August 2026). This
replaces the earlier ₹3–8 estimate, which was low. A custom provider
(`VOICE_CALL_PROVIDER=custom`) has its own economics; revisit the price
if the fallback becomes the primary.

## Our price to the account

`AI_FEATURE_COSTS.voice_campaign_call = 25 cr` (src/lib/credits/types.ts).

**This price is currently below raw cost, and knowing that is the
point of writing it down.** A credit sells for ₹0.062–0.099 depending
on the pack (migration 087: 1,000 cr for ₹99 up to 16,000 cr for ₹999),
so 25 cr is **₹1.56–2.48** of revenue against a ₹9.80–14.70 call — a
subsidy of roughly 4–9×, not the ≥5× margin the policy rule asks for.

The earlier version of this file claimed "25 cr ≈ ₹3–8 raw → ~3–8×"
by reading credits as rupees. They are not the same unit, and no other
feature price in `AI_FEATURE_COSTS` should be read that way either.

Policy rule, unchanged and consistent with the other AI features:
**price at ≥5× raw cost**. Honouring it here means roughly 600–1,000 cr
per connected call; covering bare cost means roughly 150 cr. Raising a
live price is a product decision, not a code change — until it is
taken, voice campaigns run as a deliberate loss-leader, and that is
fine only while the operator and the account are the same company.

Charging mechanics:

- Burned **up front per dial attempt** by the dispatcher
  (`/api/cron/voice-campaigns`), before `startOutboundCall` — the
  credits-engine rule: burn before the external call. The burn uses a
  per-attempt `retryKey` (`voice-call:<recipient>:<attempt>`), so a
  crashed-and-rerun dispatch can never double-charge one attempt.
- **Auto-refunded whenever the call never connects**, from all three
  places an attempt can die:
  - the provider rejects the call start (dispatcher),
  - the attempt goes stale — no result ever arrives (dispatcher
    requeue),
  - the webhook reports `no_answer` / `busy` (guarded on the
    recipient's pre-update `calling` status so the stale refund and
    this one can never both fire).
    Net effect: **accounts pay per connected call**, including
    `wrong_number` and voicemail pickups (someone/something answered),
    never for ringing.
- Hard-blocked when the balance is short: the dispatcher reverts the
  claim, skips the campaign for that run, and reports `creditBlocked`;
  the campaign resumes automatically once the wallet is topped up.

## Informing users (disclosure rule)

Every credit-charging control states its price **before** the user
commits:

- Web: the create-campaign dialog and the Voice Calls tab InfoHint
  both read the price from `AI_FEATURE_COSTS` — "Costs 25 cr per
  connected call; unanswered attempts are refunded automatically."
- Mobile: the create sheet shows the same line, priced from
  `GET /api/config` (`ai_costs`) so it can never drift from what is
  burned.
