# Credit Policy: Listing Video (Sarvam-backed)

## Raw cost per render (Sarvam, platform.sarvam.ai/pricing)

A generated video consumes:

| Item | Typical usage | Notes |
|---|---|---|
| Sarvam Translate (mayura) | ~400–600 chars | only for non-English narration |
| Sarvam TTS (bulbul:v2) | ~400–600 chars | 1 request per ≤450-char chunk |
| Worker CPU (ffmpeg) | ~30–60s | already-paid Railway container |
| Storage + egress | ~2–3 MB | negligible; R2 later = free egress |

Sarvam sells credits in ₹ packs (e.g. ₹10,000 → 12,500 credits →
**₹0.80 per Sarvam credit**), pooled across all their APIs. At their
published per-character rates a typical render lands around **₹1–4
all-in** (English-only, no translate, is the cheap end). Verify the
exact per-model rates in the collapsed "Text to Speech API" section
of their pricing page when the key is provisioned, and re-check this
table if they reprice.

## Our price to the account

`AI_FEATURE_COSTS.listing_video = 50 cr` (src/lib/credits/types.ts).

Policy rule, consistent with the other AI features: **price at ≥5×
raw cost** so the feature stays margin-positive across languages,
retries, and Sarvam price drift. 50 cr ≈ ₹2–4 raw cost → ~12–25×
today, leaving room to cut the price later rather than raise it.

Charging mechanics (already wired):

- Charged **up front** via `burnCredits` in
  `POST /api/properties/[id]/generate-video` (credits-engine rule:
  burn before the external call).
- **Auto-refunded** by the worker if the render fails
  (`refundCredits` in listing-video-worker.ts) — users never pay for
  a failed video.
- Hard-blocked with a 402 + deficit when the balance is short.

## Informing users (disclosure rule)

Every credit-charging control must state its price **before** the
user commits, in credits:

- The Listing Video card shows "Costs 50 cr per render" next to the
  button, the success toast repeats the charge, and the
  out-of-credits error names the price.
- Follow-up for all AI features: a "What things cost" table on
  Settings → Credits rendered from `AI_FEATURE_COSTS` so pricing has
  one source of truth and the UI can never drift from what's burned.
