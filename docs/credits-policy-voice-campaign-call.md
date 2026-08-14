# Credit Policy: Voice Campaign Call (Sarvam-backed)

## Raw cost per connected call

A qualification call (docs/voice-agent-integration-plan.md §6) consumes:

| Item                | Typical usage               | Notes                                                                                                                                       |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice-agent minutes | ~2–3 min per connected call | Sarvam Voice Agents managed telephony; per-minute pricing — verify the current rate on platform.sarvam.ai when the workspace is provisioned |
| Unanswered attempt  | ~0                          | no connection, no meaningful telephony cost                                                                                                 |
| Webhook processing  | negligible                  | own infra                                                                                                                                   |

Estimated raw cost per connected call: **~₹3–8** at typical Indian
voice-agent per-minute rates. Re-check this table against Sarvam's
published Voice Agents pricing once live — the platform went GA in
August 2026 and rates may move. A custom provider
(`VOICE_CALL_PROVIDER=custom`) has its own economics; revisit the
price if the fallback becomes the primary.

## Our price to the account

`AI_FEATURE_COSTS.voice_campaign_call = 25 cr` (src/lib/credits/types.ts).

Policy rule, consistent with the other AI features: **price at ≥5×
raw cost**. 25 cr ≈ ₹3–8 raw → ~3–8× today at the estimate's midpoint;
tighten upward only if measured per-minute costs come in above the
estimate — cutting a price is fine, raising one is not.

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
