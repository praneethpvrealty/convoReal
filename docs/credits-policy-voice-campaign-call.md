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

Two prices, because two different parties pay the provider
(src/lib/credits/types.ts, resolved by `voiceCallCost(mode)`):

| Mode                  | Price      | Why                                                                    |
| --------------------- | ---------- | ---------------------------------------------------------------------- |
| `shared`, `dedicated` | **250 cr** | We pay Sarvam for the minutes, so the charge has to cover them         |
| `byo`                 | **10 cr**  | The account's own provider is billed; we charge for orchestration only |

At ₹0.062–0.099 per credit (migration 087: 1,000 cr for ₹99 up to
16,000 cr for ₹999), 250 cr is **₹15.60–24.75** against a ₹9.80–14.70
call — roughly 2× raw cost. That is below the ≥5× rule the other AI
features follow, and deliberately so: 5× would be ₹37–59 a call, which
does not survive comparison with a person making the same call.

An earlier version of this file claimed 25 cr was "3–8×" its cost by
reading credits as rupees. They are not the same unit, and no other
price in `AI_FEATURE_COSTS` should be read that way either.

**Refund exactly what was charged.** The price now depends on a mode
the account can change, and two of the three refund paths run long
after the dial (the webhook, the stale sweep). Migration 279 records
`charged_credits` on the attempt, and every refund returns that
number — never a freshly computed one.

## What the account is told

A price per call is not a decision an agency can act on. Both surfaces
put the charge next to the thing it replaces, at the moment the
campaign is started (`src/lib/credits/time-value.ts`, mirrored in
`mobile/lib/time-value.ts`):

> 3,500 cr (₹347) for calls that would take an agent 1.0 hours by hand
> — ₹750 of their time. Saves about ₹404.

The assumptions behind that line are all set to understate the saving:
credits are valued at the **dearest** pack (₹0.099; bulk buyers pay
less and save more), the manual rate is a brisk 14 calls an hour, and
the comparison prices every call as connecting when unanswered ones are
refunded. The default salary is ₹1.5L/month over a 200-hour month —
₹750/hour.

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
  both price from `voiceCallCost(mode)` — "Costs 250 cr per connected
  call; unanswered attempts are refunded automatically." Starting a
  campaign restates it as the trade above, for the number of calls
  actually queued.
- Mobile: the create sheet and the campaign screen show the same
  figures, priced from `GET /api/config` (`ai_costs`) and the
  account's mode, so neither can drift from what is burned.
