# External Services Audit & Launch Upgrade Plan

An inventory of every third-party service ConvoReal depends on, what tier each one sits on, the limits that bind at that tier, and the order in which to upgrade them around launch.

**Account state verified live on 2026-08-12** against the Vercel and Supabase management APIs. **Public pricing verified the same day** — vendor pricing drifts, so re-check the figures before acting on anything more than a few months later.

---

## 1. Live account state

| | Finding |
| :--- | :--- |
| **Vercel** | Team `praneeth-kumar-sajepa-s-projects`, project `convoreal`, Node 24.x. Domains: `convoreal.com`, `www.convoreal.com`, `app.convoreal.com`. **Pro (paid).** |
| **Supabase** | Org `praneethpvrealty's Org` — **plan: `free`**. Active project `convoReal`, `ap-south-1` (Mumbai), Postgres 17.6, healthy. Two older projects (`sb1-rbimfinl` us-east-1, `wa based crm` ap-southeast-2) are paused. |

How the Vercel tier was determined: all 13 crons in `vercel.json` fired at their configured frequency in a 24-hour window (`broadcast-sweep` 289 invocations, `appointments/cron` 96, `location-request-timeouts` 96). Hobby caps at 2 cron jobs run once per day, so this is only reachable on Pro.

### Supabase consumption at the time of audit

| Meter | Used | Free-plan limit | Headroom |
| :--- | :--- | :--- | :--- |
| Database size | 36 MB | 500 MB | 7% |
| File storage | ~251 MB | 1 GB | 25% |
| Auth users | 10 | 50,000 MAU | — |

Storage breakdown: `property-images` 572 files / 183 MB, `property-videos` 48 MB, `property-documents` 18 MB, `property-images-private` 618 kB, `avatars` 1.65 MB. `chat-media`, `flow-media` and `call-recordings` are empty.

Row counts: 10 accounts, 135 properties, 572 contacts, 3,663 messages.

Derived per-account averages used for the projections in §5: **~25 MB storage** and **~3 MB database** per account; 4.2 images per property at ~320 KB each.

---

## 2. Service inventory

### 2.1 Infrastructure

| Service | Used for | Tier | Limits that bind |
| :--- | :--- | :--- | :--- |
| **Vercel** | Next.js hosting, 13 cron jobs, `@vercel/analytics` | **Paid — Pro, $20/developer/mo** | 1 TB fast data transfer, 10M edge requests included; $20/mo credit then on-demand. Function timeout 300s default (800s max). **Cron function timeout is 60s on Pro** — `broadcast-sweep` and the digest crons must finish inside it. |
| **Supabase** | Postgres, Auth, Storage (8 buckets), Realtime | **Free — should be Pro ($25/mo)** | 500 MB DB, 1 GB storage, 5 GB egress, **no backups**, 1-day log retention, 2 active projects, pauses after 7 days idle. Pro: 8 GB DB, 100 GB storage, 250 GB egress, 7-day PITR. |
| **Upstash Redis** | `whatsapp-webhooks` queue + DLQ (`REDIS_URL`) | Free tier per `docs/production-deployment.md` | 256 MB, **500K commands/month**, then $0.20/100K. |
| **Railway** | `go-ingress` container + `queue-worker` daemon | Hobby $5/mo per deployment docs | Hobby includes $5 usage; the Free plan's $1/mo credit will not keep two always-on containers running. Two 512 MB containers run ~$10–15/mo all-in. |
| **Cloudflare** | DNS, WAF, Email Routing on `leads.convoreal.com`, Worker `convoreal-leads-webhook-forwarder`, Workers KV `LEADS_LEDGER` | **Free** (explicit in `docs/CLOUDFLARE_EMAIL_SETUP.md`) | Workers: 100k req/day, 10ms CPU/req. KV: 100k reads, 1k writes/day. Email Routing unmetered. |

### 2.2 Meta / WhatsApp

| Service | Used for | Tier | Limits |
| :--- | :--- | :--- | :--- |
| **WhatsApp Cloud API** (Graph v21.0) | All messaging, templates, media, flows | **Usage-billed, no subscription** | India: marketing **₹1.09/msg**, utility & authentication **₹0.145/msg**, service (in-window) currently free. See §6 for the pricing changes landing in 2026. |
| **Meta Ads API** | Campaign integration | Free API, gated by `META_ADS_ENABLED` | Ad spend is separate. Currently off. |

### 2.3 AI & media — all usage-billed, no subscriptions

| Service | Used for | Tier | Limits |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | Copilot, chatbot engine, intake parsing, listing derivations, `gemini-embedding-001`. Chains in `src/lib/ai/gemini.ts`: standard `gemini-2.5-flash` → `gemini-3.5-flash`; lite `gemini-3.1-flash-lite` → `gemini-2.5-flash` | Free unless billing is attached | Free 2.5 Flash: ~10 RPM / 250K TPM / **500 RPD**. Paid: $0.30/M input, $2.50/M output. |
| **Google Maps / Places** | Locality lookup, inventory map | Pay-as-you-go | The universal $200 credit was retired in March 2025. Now **10,000 free calls per SKU per month, non-pooling**. Place Details $5/1,000 on Essentials thereafter. |
| **Google OAuth + YouTube Data API** | Listing video upload | Free API | **10,000 quota units/day; one upload costs ~1,600 units → ~6 uploads/day per project.** Hard ceiling. |
| **Stability AI** | AI photo enhancement (`sd3` / `ultra`) | Prepaid credits | ~$0.04/image SD3, ~$0.08 Ultra. No free tier. |
| **Hugging Face** | Image-gen fallback via router → `fal-ai/FLUX.1-dev` | PAYG via HF Inference Providers | Free credits are minimal; routed provider cost passes through. |
| **Sarvam AI** | TTS narration for generated listing videos | Usage-billed | Per-character billing. |

### 2.4 Payments, email, comms

| Service | Used for | Tier | Notes |
| :--- | :--- | :--- | :--- |
| **Razorpay** | Marketplace + subscription checkout (India) | No subscription | ~2% + GST per domestic transaction. |
| **Stripe** | Credit top-ups | No subscription | ~2.9% + 30¢ (international rate). |
| **Resend** | Transactional email — support tickets, password resets, sandbox cron, billing extension notices, image-cleanup notices. Not auth OTP (that is WhatsApp — see §3) | **Free** | 3,000 emails/mo, **hard cap 100/day**, one domain. Pro is $20/mo for 50,000. Volume is admin/ops only, so this tier has long headroom. Repricing risk and exit cost in §7. |
| **IMAP lead sync** | `IMAP_HOST` / `IMAP_USER` / `IMAP_PASSWORD` | **Not wired.** `/api/leads/sync-emails` returns "IMAP sync is currently unconfigured"; no IMAP library in `package.json`. Superseded by the Cloudflare email worker. | — |

### 2.5 Dev, CI, mobile

| Service | Used for | Tier | Limits |
| :--- | :--- | :--- | :--- |
| **GitHub** | Repo + Actions (`ci.yml`, `opencode.yml`) | Free public / 2,000 min/mo private | `main` protection ruleset requires the `CI` gate job. |
| **OpenCode** (`anomalyco/opencode/github@latest`) | `/oc` PR-comment agent, `OPENCODE_API_KEY`, model `opencode/deepseek-v4-flash-free` | Free model selected | Third-party Action with repo read access — review if not deliberately adopted. |
| **Expo / EAS** | Mobile builds, updates, submit. Owner `praneethpvrealtys-team`, project `35ac40bb-d476-4b1f-ae5f-139b38e409dd` | **Free tier** | 15 Android + 15 iOS builds/mo, 1,000 update MAUs, 100 GiB bandwidth, no concurrent builds. Production is $199/mo. |
| **Apple Developer / Google Play** | `com.convoreal.app` distribution | $99/yr + $25 one-time | Required to publish. Store review takes weeks. |

### 2.6 Referenced in docs but not actually used

`docs/scaling-costs.md` describes a target architecture, not the current one. **Cloudflare R2 is not in use** — all media is on Supabase Storage. **Sentry, BetterStack, Datadog and PostHog are not integrated** — there is currently no error monitoring or uptime alerting anywhere in the codebase.

---

## 3. Auth delivery is on WhatsApp, not email

Verified against `auth.users` on 2026-08-12. **Supabase's built-in email provider is not on any live auth path**, so its 2-per-hour project-wide cap and team-addresses-only restriction do not apply here.

**Email signup is auto-confirmed.** `src/app/(auth)/signup/page.tsx:117` calls `supabase.auth.signUp()` with `emailRedirectTo`, but every self-serve email user in the database has `email_confirmed_at` set 0.07–0.3s after `created_at`. That is auto-confirm enabled in the project's Auth settings: no confirmation email is sent, and the `emailRedirectTo` argument is inert while that setting holds.

**WhatsApp signup and login work.** `src/app/(auth)/login/page.tsx:169` calls `signInWithOtp({ phone })`; Supabase's SMS hook posts to `/api/auth/sms-hook`, which HMAC-verifies the payload (`SUPABASE_SMS_HOOK_SECRET`, Svix and `t=`/`v1=` header formats both handled) and delivers the code via `sendTextMessage` / `sendTemplateMessage` on the WhatsApp Cloud API. Confirmed in production data: the most recent user has no email address at all, phone only, `phone_confirmed_at` 8 seconds after `created_at`. The Den and Buyer portals use the same `signInWithOtp` path.

**Password reset does not use Supabase's mailer either** — `/api/auth/reset-password/request` sends through Resend.

Two consequences worth tracking:

- **WhatsApp is on the authentication critical path.** If `whatsapp_config` breaks for the account issuing OTPs, users cannot log in. This is a higher-severity single point of failure than anything in the cost tables below.
- **Every OTP is a billable authentication-category message** at India's ₹0.145 rate. This scales with login frequency, not account count — roughly ₹580/mo at 200 accounts averaging 20 logins each.

**Conditional caveat:** if email confirmation is ever switched on, or magic-link email login is added, custom SMTP must be configured *first* (*Authentication → Emails → SMTP Settings*, pointed at the existing Resend account) — otherwise the default provider's 2/hour, team-addresses-only limits do become a hard blocker. It is not a blocker today.

---

## 4. Tier 0 — do before launch

This table is the infrastructure gate for the invite-only beta; [`docs/invite-only-beta-plan.md`](./invite-only-beta-plan.md) §7 restates it as a launch-day checklist with the beta-specific consequence of each item.

| Action | Cost | Rationale |
| :--- | :--- | :--- |
| Supabase Free → **Pro** | **$25/mo** | Backups + 7-day PITR, and removes the 500 MB / 1 GB / 5 GB ceilings and the idle-pause risk. Required the moment a paying customer's data lands. |
| Confirm the OTP-sending WhatsApp number is healthy and monitored | $0 | §3. WhatsApp is the login path; if it breaks, nobody can sign in. |
| Attach billing to the Gemini API key | ~$5/mo actual | 500 req/day free cap. Digest crons batch AI calls and fail **silently** when throttled. |
| Verify Railway is on Hobby, not Free | ~$10–15/mo | The Free plan's $1/mo credit cannot keep `go-ingress` and `queue-worker` running 24/7. |
| Upstash: enable pay-as-you-go, stay on the free tier | $0 until 500K commands | Prevents a hard stop at the free ceiling; $0.20/100K after. No fixed plan needed. |
| Sentry Developer (or equivalent) | $0 | There is currently no error monitoring at all. |
| Apple Developer + Google Play, if mobile ships | $99/yr + $25 once | Store review takes weeks — start early. |

**Launch-month run rate: ~$68/mo (≈ ₹6,000)**, inclusive of the existing Vercel Pro $20.

Against ConvoReal's own pricing in `src/lib/billing/plan-config.ts` — Solo Pro ₹799, Team ₹2,499, Agency ₹5,999 — **one Agency account, or three Team accounts, covers the entire infrastructure bill.** Infrastructure cost is not the binding constraint at launch.

---

## 5. Tier 1 — upgrade on triggers, not on schedule

Thresholds projected from the §1 per-account averages.

| Watch | Threshold | Action | Cost |
| :--- | :--- | :--- | :--- |
| **Supabase egress** | >200 GB/mo — roughly **~200 active accounts**, assuming ~500 showcase visits per account at ~2.5 MB of images per visit | **This is the first real ceiling.** Move `property-images` behind a CDN or Cloudflare R2 (zero egress fees) | R2 ~$0.015/GB stored, $0 egress |
| **Upstash commands** | >500K/mo — roughly **~50 accounts** at ~1,000 WhatsApp messages each | Nothing; PAYG absorbs it | ~$2–20/mo |
| **Supabase DB size** | >6 GB of 8 — **~2,000+ accounts** | Compute add-on / larger disk | +$10–60/mo |
| **Supabase storage** | >80 GB of 100 — **~3,500 accounts** | Same R2 move as egress | — |
| **Resend** | >60 emails/day or >2,500/mo | Pro | $20/mo |
| **Vercel** | Transfer >800 GB or edge requests >8M | Nothing — Pro's $20 credit absorbs overage first | usage-based |
| **Railway** | Worker CPU sustained >70%, or queue depth growing | Add worker replicas | ~$5/replica |
| **Expo EAS** | >15 builds/month per platform | Buy on-demand build credits. **Do not move to Production ($199/mo)** until past ~40k MAU | ~$1–2/build |

The shape of that table matters more than any single row: **Supabase Pro carries the product to roughly 200 accounts before anything else needs money, and the meter that breaks first is image egress from the public showcase** — not database size, not compute. The CDN/R2 migration is the one architectural change worth planning ahead for. Everything in `docs/scaling-costs.md` beyond Tier 1 should stay unbought until its trigger actually moves.

---

## 6. Variable costs that are not subscriptions

### WhatsApp is pass-through, and repricing in 2026

- **1 Aug 2026** — a "Meta Business Agent" category bills AI replies per token at $2.00 USD per 1M tokens.
- **1 Oct 2026** — utility templates **and** service messages sent inside the 24-hour customer window become chargeable, and several markets move to standalone rate cards.

The second change hits ConvoReal directly: `owner-digest`, `agent-inventory-digest`, `buyer-match-digest`, `agent-task-digest` and the appointment reminders are all utility templates. At India's ₹0.145/message an account receiving 100 digest messages a month costs ₹14.50 — negligible per account, material at several hundred. Before scaling past a few hundred accounts, either price this into the plan tiers or require clients to attach their own Meta billing.

### Gemini scales with conversations, not accounts

Chatbot replies dominate token spend. At $0.30/M input on 2.5 Flash this stays under ~$30/mo well past 1,000 accounts.

---

## 7. Vendor risk and exit cost

Free tiers are a vendor's marketing budget, not a contract. The question that matters for each dependency is not "will this stay free" but "what does it cost us to leave".

### Resend — small exposure, one-function exit

Resend reprices without much warning: in 2026 the Scale tier was restructured with several published prices doubled (the 200,000/mo tier went $80 → $160), and data retention on all non-Enterprise plans was changed with no public announcement. Treat the 3,000/mo free tier as revocable.

The exposure is nonetheless small, because `src/lib/email.ts` already isolates it. The entire Resend coupling is the `resend` import, the `getResend()` singleton, and the body of `sendTransactionalEmail()`. Every template builder in that file (`buildTrialExpiryEmail`, `buildSubscriptionExtensionEmail`, `buildImageCleanupWarningEmail`) is provider-agnostic HTML and text, and all five call sites only ever see the `{ success, messageId?, error? }` return shape.

**Migrating providers is therefore a rewrite of one function body — roughly 30 lines — with no call site changes.** Do not add an `EmailProvider` interface or a provider-registry abstraction ahead of an actual migration; per §2.2 of `AGENTS.md` that is a speculative abstraction, and the existing wrapper already sits at the correct seam.

The one thing that would widen the blast radius: wiring Supabase Auth SMTP to Resend (the conditional in §3). That places Resend in a dashboard setting outside this file, making a future migration two changes in two systems. Not a reason to avoid it — a reason to record it here.

Replacement candidates, for an India-based entity billing in INR:

| Option | Cost | Trade-off |
| :--- | :--- | :--- |
| **Amazon SES** (Mumbai `ap-south-1`) | ~$0.10 per 1,000 | Cheapest at any volume, same region as Supabase. Requires a production-access request to exit sandbox mode; heavier setup. |
| **Zoho ZeptoMail** | ~$2.50 per 10,000 | India-based, INR billing, transactional-only. Simplest migration. |
| **Brevo** | 300/day free (~9,000/mo) | A more generous free tier than Resend's, if the goal is to stay at zero cost. |

At current volume — admin and ops mail only, with auth OTP on WhatsApp (§3) — SES would cost well under $1/month.

### Concentration elsewhere

Ranked by what an exit would actually cost, not by likelihood:

- **Supabase** — highest. Postgres is portable, but RLS policies, `is_account_member()`, Auth, Storage and Realtime are not. Assume a migration is a project, not a task. This is the argument for paying for Pro rather than optimising the bill.
- **Meta / WhatsApp Cloud API** — no alternative exists. It is the product. Manage this through pricing (§6), not through portability.
- **Vercel** — moderate. A Next.js app moves to another host, but the 13 cron jobs in `vercel.json` and the build pipeline would need rebuilding elsewhere.
- **Gemini, Stability, Hugging Face, Sarvam** — low. All are behind narrow call sites in `src/lib/ai/` and `src/lib/video/`, all interchangeable with competitors.
- **Upstash, Railway, Cloudflare** — low. Standard Redis, a Dockerfile, and DNS plus a Worker. Each is replaceable in a day.

## 8. Do not buy yet

Supabase Team ($599/mo — SOC 2 and SSO are not needed), Expo Production ($199/mo), Vercel Enterprise, Upstash fixed plans, dedicated Redis (ElastiCache / Redis Cloud), and Datadog or BetterStack. Each is a Tier-3 line item in `docs/scaling-costs.md` and none of their triggers are close.

---

## 9. Sources

Pricing and limits verified 2026-08-12:

- [Supabase pricing](https://supabase.com/pricing) · [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan) · [Vercel limits](https://vercel.com/docs/limits) · [Vercel cron jobs](https://vercel.com/docs/cron-jobs)
- [Upstash Redis pricing](https://upstash.com/pricing/redis) · [Railway pricing plans](https://docs.railway.com/pricing/plans)
- [Resend pricing](https://resend.com/pricing) · [Resend 2026 repricing and retention changes](https://coldletter.com/blog/resend-pricing/) · [Expo/EAS tiers](https://agentdeals.dev/vendor/expo)
- [WhatsApp Business API pricing 2026](https://blueticks.co/blog/whatsapp-business-api-pricing-2026) · [India rate update](https://chati.ai/blog/whatsapp-business-api-pricing-update-for-2026)
- [Gemini API free-tier limits](https://aipromptshub.co/blog/gemini-api-free-tier-rate-limits) · [Gemini pricing](https://findskill.ai/blog/gemini-api-pricing-guide/) · [Google Maps API pricing 2026](https://www.mapsi.dev/google-maps-api-pricing)
