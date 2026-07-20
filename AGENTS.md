# ConvoReal — AI Agent Handbook

> This file is written for AI coding agents. It is a single source of truth for the project’s architecture, conventions, build/test commands, and security rules. Read it before editing code. If something here conflicts with project-specific docs, this file and the most specific doc (deepest path) win.

## Important: This is NOT the stock Next.js you trained on

Next.js 16 has breaking changes compared with older versions — APIs, file conventions, and behaviour differ from training data. Before writing code, read the relevant guide in `node_modules/next/dist/docs/` and heed any deprecation notices. Do not assume the patterns from Next.js 14/15 work unchanged.

---

## 1. What this project is

ConvoReal is a self-hostable **WhatsApp CRM for real-estate brokerages** (originally forked from the `wacrm` template). It provides:

- Property inventory (50+ fields, images, documents, floor tenancies, RERA, AI-generated descriptions).
- Contact/lead management with classification, tags, custom fields, and matching preferences.
- Shared WhatsApp inbox via the Meta Cloud API (messages, templates, media, reactions).
- Sales pipelines (Kanban), deals, and journey mind-map.
- Broadcast campaigns, no-code automations, and interactive WhatsApp flows.
- Public showcase portal (branded property listings, buyer/agent modes, interest tracking, document requests).
- Email lead sync from MagicBricks / Housing.com / 99acres via IMAP webhooks.
- Owner digests, appointment reminders, calendar & to-dos.
- **Owners Den** — a separate owner-facing portal for deal-mode matching, bids, and token-safe deal rooms.
- **Mobile app** — an Expo/React Native companion app in `mobile/`.

All tenant data lives in one Supabase PostgreSQL database and is isolated by `account_id` through Row-Level Security (RLS).

---

## 2. Non-negotiable rules (AI Engineering Constitution)

These rules are hard project conventions. Violating them will break the app or the security model.

### 2.1 Read before you write

- Read the full file (or the relevant section plus surrounding context) before editing it.
- Read neighbouring files before creating new ones.
- Verify a library/pattern is already in use before adding it.

### 2.2 Minimal, idiomatic code

- No explanatory or inline comments unless explicitly asked. Code is expected to be self-documenting.
- Match existing naming, formatting, and structure.
- Do not add speculative abstractions or general-purpose utilities that are not required.
- Do not use placeholders like `// TODO` or `// ...rest`.
- Do not use mock data blocks. Use real URLs and upload helpers.

### 2.3 Stack immutables

| Layer | Technology | Constraint |
|-------|-----------|------------|
| Framework | Next.js 16 (App Router) | Use `app/` directory conventions; no `pages/` router |
| React | 19.x | Functional components and hooks only; no class components |
| TypeScript | ^6 | `strict` mode; avoid `any` |
| Styling | Tailwind CSS v4 | `src/app/globals.css` with `@import "tailwindcss"`; PostCSS v4 setup |
| UI primitives | shadcn/ui (`base-nova` style) | Reuse `src/components/ui/`; do not duplicate |
| Icons | lucide-react | Do not import other icon libraries |
| Database | Supabase (PostgreSQL) | Every operational table must have `account_id` and RLS |
| Auth | Supabase Auth | `@supabase/ssr` for SSR; `useAuth()` for client |
| State | React Context + hooks | No Redux, Zustand, or other external state managers |
| Charts | Recharts | Do not add another chart library |
| Toasts | sonner | Used via `<Toaster>` in root layout |
| Dates | date-fns | No moment.js or dayjs |
| Drag & drop | @dnd-kit | Pipeline Kanban board |
| Flow builder | @xyflow/react | Automations/flows visual builder |
| HTTP client | `fetch` (built-in) | No axios |
| Webhook ingress | Go 1.24 (`go-ingress/`) | HMAC validation + Redis fan-out |
| Queue | Redis (go-redis + ioredis) | `whatsapp-webhooks` list, `whatsapp-webhooks-dlq` for dead letters |

### 2.4 File and naming conventions

- Directories: kebab-case (e.g., `src/components/flow-builder`).
- Files: camelCase for utilities/hooks, PascalCase for React components (e.g., `useAuth.tsx`, `property-card.tsx`).
- Path alias: `@/` maps to `./src/*` in `tsconfig.json`.
- Imports: prefer `@/lib/...`, `@/components/...`, etc.
- Components: define props interfaces inline at the top of the file.
- Client components: add `"use client"` only when needed (hooks, browser APIs, state). Server components are the default.

### 2.5 Security rules

- Never log, expose, or commit secrets, tokens, or encryption keys.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never import it into client components or browser code.
- WhatsApp access tokens are stored AES-256-GCM encrypted in `whatsapp_config.access_token`. Decrypt at runtime with `ENCRYPTION_KEY`.
- All WhatsApp webhook verification uses HMAC-SHA256 with `META_APP_SECRET`.
- Auth-gated API routes must call `supabase.auth.getUser()` (via `createClient()` from `src/lib/supabase/server.ts`).
- Public routes go under `/api/public/` and use a service-role client intentionally (RLS bypassed for public access).
- Webhook routes (`/api/whatsapp/webhook`, `/api/leads/email-webhook`, etc.) use a service-role client.
- Rate-limit sensitive public endpoints using `src/lib/rate-limit.ts`.

### 2.6 Database rules

- Every operational table must have `account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE`.
- Enable RLS on every operational table.
- Use `is_account_member()` (SECURITY DEFINER) in RLS policies for tenant membership.
- Service-role clients must still enforce `account_id` scoping in code; do not rely on RLS alone when bypassing it.

### 2.7 WhatsApp rules

- Store `mediaId`, not Meta CDN URLs. Build viewing URLs via `/api/whatsapp/media/[mediaId]`.
- Only send UTILITY/MARKETING templates outside the 24-hour free-form window.
- Always check template status before sending; sync statuses via `POST /api/whatsapp/templates/sync`.
- Webhook payloads must be verified by `verifySignature()` from `src/lib/whatsapp/webhook-signature.ts` before processing.

---

## 3. Tech stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| App server | Next.js 16.2.6 (App Router) | `next.config.ts` at project root |
| Language | TypeScript ^6 | `tsconfig.json` strict mode, `@/` alias |
| React | 19.2.4 | Server components by default |
| Styling | Tailwind CSS v4 | `@import "tailwindcss"` in `src/app/globals.css` |
| UI kit | shadcn/ui (`base-nova`) | `components.json` configures aliases and style |
| Icons | lucide-react | Only icon library used |
| Database | Supabase (PostgreSQL + RLS + Realtime) | `supabase/migrations/` and `supabase/RUN_IN_SUPABASE_SQL_EDITOR.sql` |
| Auth | Supabase Auth (GoTrue) | `@supabase/ssr` cookie-based SSR + mobile bearer-token support |
| Storage | Supabase Storage (S3-compatible) | Avatars, property images, documents |
| WhatsApp | Meta Cloud API v21.0 | `src/lib/whatsapp/meta-api.ts` |
| AI | Google Gemini 2.5 / 1.5 flash | `src/lib/ai/gemini.ts` |
| AI images | Google Imagen / Hugging Face | `HF_ACCESS_TOKEN` for Hugging Face |
| Queue | Redis | `ioredis` in Node, `go-redis` v9 in Go |
| Ingress | Go 1.24.3 | `go-ingress/main.go` + `Dockerfile` |
| Email | Resend | `src/lib/email.ts` |
| Payments | Razorpay + Stripe | `src/lib/marketplace/razorpay.ts`, `src/lib/credits/stripe.ts` |
| Maps | Google Places | `src/lib/maps/google-places.ts` |
| Cron | Vercel Cron | `vercel.json` |
| Analytics | Vercel Analytics | `@vercel/analytics` |
| Mobile | Expo ~57 / React Native 0.86 | `mobile/` directory, separate package.json |
| Browser extension | Chrome portal autofill | `extension/portal-autofill/` |

---

## 4. Project structure

```text
convoReal/
├── next.config.ts                # Next.js config (headers, redirects, cache rules)
├── package.json                  # Node deps and scripts
├── tsconfig.json                 # TS strict, @/ alias, excludes mobile/
├── vitest.config.ts              # Unit test config (no network, dummy secrets)
├── vitest.integration.config.ts  # Integration test config (live Supabase)
├── eslint.config.mjs             # eslint-config-next/core-web-vitals + typescript
├── .prettierrc                   # Prettier config
├── components.json               # shadcn/ui configuration
├── vercel.json                   # Build ignore rules + cron schedules
├── Dockerfile.worker             # Docker image for the queue worker
├── src/
│   ├── app/                      # Next.js App Router pages + API routes
│   │   ├── (auth)/               # Login, signup, forgot-password, reset-password
│   │   ├── (dashboard)/          # Auth-gated dashboard pages
│   │   │   ├── dashboard/        # Home dashboard
│   │   │   ├── inbox/            # WhatsApp shared inbox
│   │   │   ├── contacts/         # Contacts/leads
│   │   │   ├── inventory/        # Property inventory
│   │   │   ├── pipelines/        # Kanban deals
│   │   │   ├── broadcasts/       # WhatsApp broadcast campaigns
│   │   │   ├── automations/      # No-code automation builder
│   │   │   ├── flows/            # Interactive WhatsApp flow builder
│   │   │   ├── calendar/         # Appointments & to-dos
│   │   │   ├── journey/          # Journey mind-map
│   │   │   ├── settings/         # Account settings
│   │   │   └── ...               # agents, ads, today, pulse, radar, requirements, admin, dev
│   │   ├── (den)/den/            # Owners Den portal (separate auth)
│   │   ├── api/                  # REST API routes (route.ts files)
│   │   ├── docs/[token]/         # Public document viewer
│   │   ├── join/[token]/         # Invitation acceptance
│   │   ├── list/                 # Public listing referral page
│   │   ├── page.tsx              # Landing / showcase page
│   │   ├── layout.tsx            # Root layout + theme boot script
│   │   └── globals.css           # Tailwind v4 + theme tokens
│   ├── components/               # React components by domain
│   │   ├── ui/                   # shadcn/ui primitives
│   │   ├── layout/               # Sidebar, header, shell
│   │   ├── inbox/                # WhatsApp chat components
│   │   ├── inventory/            # Property forms, cards, share dialogs
│   │   ├── contacts/             # Contact forms, preferences
│   │   ├── pipelines/            # Kanban board, deal cards
│   │   ├── showcase/             # Public portal components
│   │   ├── settings/             # Settings panels
│   │   ├── automations/          # Automation builder UI
│   │   ├── flows/                # Flow builder UI
│   │   ├── broadcasts/           # Broadcast wizard
│   │   ├── calendar/             # Calendar & to-do components
│   │   ├── dashboard/            # Dashboard widgets
│   │   ├── den/                  # Owners Den UI
│   │   └── ...
│   ├── hooks/                    # Custom React hooks (auth, RBAC, realtime, theme, etc.)
│   ├── lib/                      # Business logic & utilities
│   │   ├── supabase/             # Client factories (client, server, admin patterns)
│   │   ├── whatsapp/             # Meta API, webhooks, templates, encryption, flows
│   │   ├── ai/                   # Gemini integration, chatbot engine
│   │   ├── automations/          # Automation execution engine
│   │   ├── flows/                # Interactive flow engine
│   │   ├── auth/                 # Auth helpers, RBAC
│   │   ├── contacts/             # Contact helpers
│   │   ├── inventory/            # Property helpers, matching
│   │   ├── matching.ts           # Contact-property matching engine
│   │   ├── dashboard/            # Dashboard data queries
│   │   ├── den/                  # Owners Den logic
│   │   ├── marketplace/          # Razorpay, billing, credits
│   │   ├── storage/              # Uploads, image cleanup
│   │   ├── email.ts              # Resend wrapper
│   │   ├── maps/                 # Google Places proxy
│   │   ├── data/                 # Static/locality data
│   │   └── utils.ts              # `cn()` Tailwind merge helper
│   ├── scripts/                  # Background workers and admin scripts
│   │   ├── queue-worker.ts       # Redis consumer for WhatsApp webhooks
│   │   ├── replay-dlq.ts         # Replay dead-letter queue
│   │   ├── check-documents-column.ts
│   │   ├── backfill-property-coords.ts
│   │   └── ...
│   ├── types/                    # Shared TypeScript definitions
│   └── proxy.ts                  # Next.js 16 middleware (middleware.ts was renamed to proxy.ts in v16) — auth gating, runs before every matched route
├── go-ingress/                   # Standalone Go webhook ingress
│   ├── main.go                   # HMAC verify + Redis enqueue
│   ├── main_test.go              # Go tests
│   ├── Dockerfile                # Multi-stage Alpine build
│   ├── go.mod / go.sum           # Go 1.24.3, go-redis v9
├── supabase/
│   ├── migrations/               # 154 numbered SQL migrations (001–146 with some gaps/collisions)
│   └── RUN_IN_SUPABASE_SQL_EDITOR.sql  # Consolidated schema seed
├── docs/                         # Deployment and architecture guides
├── mobile/                       # Expo React Native app (separate package.json)
└── extension/portal-autofill/    # Chrome extension
```

### Codebase size (rough)

- `src/app`: ~257 files, 82 pages + routes (`page.tsx`/`route.ts`).
- `src/components`: ~186 files.
- `src/lib`: ~222 files.
- `src/**/*.test.ts`: ~82 test files.
- `supabase/migrations`: 154 SQL files.

---

## 5. Build, test, and development commands

All commands run from the project root unless noted.

| Command | What it does |
|---------|-------------|
| `npm install` | Install Node dependencies. |
| `npm run dev` | Start Next.js dev server on `http://localhost:3000` (Turbopack). |
| `npm run build` | Production build. Next.js also runs its own typecheck here. |
| `npm start` | Start the production Next.js server. |
| `npm run typecheck` | `tsc --noEmit` — fast TypeScript-only check. |
| `npm run lint` | ESLint via `eslint-config-next`. |
| `npm run format` | Prettier write. |
| `npm run format:check` | Prettier check (useful in CI). |
| `npm test` | Run Vitest unit tests (no network, dummy secrets). |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:integration` | Run integration tests against the live Supabase project (requires `.env.local` secrets). |
| `npm run worker` | Run the Redis webhook queue worker (`tsx src/scripts/queue-worker.ts`). |
| `npm run queue:replay-dlq` | Replay dead-letter queue messages back into the main queue. |
| `npm run check-db` | Run `src/scripts/check-documents-column.ts`. |

### Mobile app

Run from `mobile/`:

| Command | What it does |
|---------|-------------|
| `cd mobile && npm install` | Install mobile dependencies. |
| `cd mobile && npm run start` | Start Expo dev server. |
| `cd mobile && npm run android` | Start Expo for Android. |
| `cd mobile && npm run ios` | Start Expo for iOS. |
| `cd mobile && npm run lint` | Expo lint. |
| `cd mobile && npm run typecheck` | TypeScript check for mobile. |

### Go ingress

```bash
cd go-ingress
go build -o ingress-server .
./ingress-server          # PORT defaults to 8080
```

Or with Docker:

```bash
docker build -t go-ingress go-ingress/
docker run -p 8080:8080 go-ingress
```

---

## 6. Environment variables

Copy `.env.local.example` to `.env.local` and fill in the required values. The application reads these at runtime; the queue worker also loads `.env.local` automatically.

### Required core variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key (browser + SSR) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `ENCRYPTION_KEY` | 64-character hex string for AES-256-GCM token encryption |
| `META_APP_SECRET` | Meta App Secret for WhatsApp webhook HMAC verification |
| `NEXT_PUBLIC_SITE_URL` | Canonical public URL of the app (used in links and by the Go ingress proxy fallback) |

### Commonly used optional variables

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Redis connection string for webhook queueing and DLQ. Format: `redis://...` or `rediss://...` |
| `WHATSAPP_VERIFY_TOKEN` | Static Meta webhook verification token (used by Go ingress; falls back to DB-backed verification) |
| `GEMINI_API_KEY` | Google Gemini API key for AI features |
| `GOOGLE_MAPS_API_KEY` | Google Places / Maps API key |
| `RESEND_API_KEY` | Resend API key for transactional emails |
| `RESEND_FROM_EMAIL` | Sender email address (defaults to `noreply@convoreal.com`) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay credentials |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signature secret |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe credentials for credit top-ups |
| `META_ADS_APP_ID` / `META_ADS_APP_SECRET` | Meta Ads integration (feature-flagged by `META_ADS_ENABLED=true`) |
| `NEXT_PUBLIC_META_ADS_APP_ID` | Public Meta Ads App ID (controls UI visibility) |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASSWORD` / `IMAP_SECURE` | IMAP email lead sync |
| `LEADS_WEBHOOK_TOKEN` | Secret for `/api/leads/email-webhook` |
| `AUTOMATION_CRON_SECRET` / `CRON_SECRET` | Secret required by cron/endpoint routes |
| `SUPABASE_SMS_HOOK_SECRET` | Secret for `/api/auth/sms-hook` (WhatsApp OTP) |
| `TOKEN_SAFE_WEBHOOK_SECRET` | Secret for the token-safe escrow webhook |
| `HF_ACCESS_TOKEN` | Hugging Face token for image generation |
| `NEXT_PUBLIC_APP_URL` | Optional alias for the app URL (fallback for `NEXT_PUBLIC_SITE_URL`) |
| `NEXT_PUBLIC_BASE_DOMAIN` | Base domain for branding/subdomain logic (default `convoreal.com`) |
| `NEXT_PUBLIC_DEFAULT_WEBSITE_NAME` | Default site name (default `ConvoReal`) |
| `NEXT_PUBLIC_DEFAULT_WEBSITE_URL` | Default website URL (default `https://www.convoreal.com`) |
| `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` | Default phone country code (default `91`) |
| `NEXT_PUBLIC_DEFAULT_ACCOUNT_ID` | Default account for the public showcase landing page |
| `NEXT_PUBLIC_CRM_VERTICAL` | Active vertical (default `real_estate`) |
| `NEXT_PUBLIC_COPILOT_ENABLED` | Copilot feature flag (default `true`) |
| `NEXT_PUBLIC_CONVOREAL_SALES_WHATSAPP` | Sales WhatsApp number for landing-page fallback |
| `NEXT_PUBLIC_BUILD_ID` | Git short SHA; injected by Vercel build command in `vercel.json` |
| `REDIRECT_FROM_DOMAIN` / `REDIRECT_TO_DOMAIN` | Domain redirect rules in `next.config.ts` |
| `APPLE_TEAM_ID` / `ANDROID_APP_CERT_SHA256` | Deep-link / app-link configuration files |

### Vitest dummy secrets

`vitest.config.ts` stubs `ENCRYPTION_KEY` and `META_APP_SECRET` so unit tests run without `.env.local`. Integration tests load real credentials from `.env.local` and skip if absent.

---

## 7. Database and migrations

### 7.1 Schema source

- **Incremental migrations**: `supabase/migrations/NNN_description.sql` (154 files, numbered roughly 001–146 with some gaps and collisions — e.g. two `063_*` files).
- **Consolidated seed**: `supabase/RUN_IN_SUPABASE_SQL_EDITOR.sql` — a single file intended to be run in the Supabase SQL Editor to set up/reset the schema.
- **Schema documentation**: `DATABASE_SCHEMA.md` describes the major table groups.

### 7.2 Migration conventions

Every new operational table must include:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
created_at TIMESTAMPTZ DEFAULT NOW(),
updated_at TIMESTAMPTZ DEFAULT NOW()
```

Plus:

- `CREATE TRIGGER set_updated_at BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`
- `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
- RLS policies using `is_account_member(target_account_id, min_role)`.
- Use `IF NOT EXISTS` for idempotency.

### 7.3 Key tables by domain

| Domain | Key tables |
|--------|-----------|
| Tenancy | `accounts`, `profiles`, `account_invitations` |
| Contacts | `contacts`, `tags`, `contact_tags`, `custom_fields`, `contact_custom_values`, `contact_notes` |
| Properties | `properties`, `showcase_settings`, `rera_projects`, `property_document_requests` |
| WhatsApp | `conversations`, `messages`, `message_reactions`, `message_templates`, `whatsapp_config`, `whatsapp_meta_flows`, `whatsapp_meta_flow_sessions` |
| Pipelines | `pipelines`, `pipeline_stages`, `deals` |
| Calendar | `appointments`, `appointment_reminder_log`, `todos` |
| Automations | `automations`, `automation_steps`, `automation_logs`, `automation_pending_executions` |
| Flows | `flows`, `flow_nodes`, `flow_runs`, `flow_run_events` |
| Owners Den | `den_users`, `den_contact_links`, `match_events`, `den_match_unlocks`, `property_bids`, `property_bid_events`, `deal_rooms`, `token_escrows` |
| Marketing | `broadcasts`, `broadcast_recipients`, `contact_property_inquiries`, `showcase_events` |
| Billing | `subscriptions`, `credit_transactions`, `credit_packages`, `referrals`, `marketplace_items` |

### 7.4 RLS and multi-tenancy

- Every operational row is scoped to `account_id`.
- `is_account_member(account_id, min_role)` checks the requesting user’s membership and role.
- Roles: `owner` > `admin` > `agent` > `viewer`.
- The server Supabase client (`src/lib/supabase/server.ts`) supports both cookie-based SSR sessions and mobile `Authorization: Bearer <jwt>` tokens. RLS enforces access for both.

---

## 8. Authentication and authorization

### 8.1 Auth flow

1. User signs up/logs in via Supabase Auth (email/password or OAuth).
2. A `profiles` row is created by a database trigger.
3. The user creates or joins an `account` (multi-tenant).
4. API routes call `supabase.auth.getUser()` and then enforce `account_id` scoping/role checks.

### 8.2 RBAC

| Role | Capabilities |
|------|-------------|
| `owner` | Full control, billing, ownership transfer |
| `admin` | User management, settings |
| `agent` | Operational data (contacts, properties, messages, deals) |
| `viewer` | Read-only dashboard access |

- Server-side: `requireRole(minRole)` helpers in API routes.
- Client-side: `useCan(action)` hook for conditional rendering.
- Common helpers: `canManageMembers`, `canSendMessages`, `canViewOnly`.

### 8.3 Auth gating (`src/proxy.ts` is the Next.js 16 middleware)

**Next.js 16 renamed `middleware.ts` to `proxy.ts`.** So `src/proxy.ts` **is** the project's active middleware — it exports a `proxy(request)` function plus a `config.matcher`, and Next.js runs it before every matched route (confirmed by the `ƒ Proxy (Middleware)` line in `next build` output). There is no separate `middleware.ts`; do not add one. Auth gating is handled by, in order:

- `src/proxy.ts` (middleware) — redirects unauthenticated page requests to `/login` (or `/den/login`) and returns `401` early for auth-gated API routes.
- Server-side checks in each API route (the real boundary — the middleware gate is an early-exit optimisation).
- Client-side checks in layouts/components (e.g. `AuthProvider`, `DashboardShell`).

**The middleware authenticates via cookies only.** It builds a cookie-based Supabase client, so it never sees the mobile app's `Authorization: Bearer <jwt>` transport. Two consequences to respect when editing `proxy.ts`:

- **Bearer requests are let through the API gate** (a JWT-shaped `Authorization: Bearer` header skips the `/api/whatsapp/*` 401 gate) so the route handler — which *does* read the bearer via `createClient()` — can authenticate them. Removing this reintroduces the bug where every mobile WhatsApp call fails `Unauthorized` before the route runs. See `src/proxy.test.ts` for the regression tests.
- **`/api/whatsapp/flows/endpoint/[accountId]` is exempt** — Meta calls it without a browser session, using its own HMAC + RSA/AES crypto (`webhook-signature.ts` / `flow-crypto.ts`).

When adding a new auth-gated API path that mobile will call, either route it under a path the middleware already lets bearer tokens through, or make sure the bearer exemption covers it — otherwise the cookie-only gate will 401 mobile before the handler runs.

---

## 9. WhatsApp integration architecture

```text
Meta Cloud API
      │
      │ POST /api/whatsapp/webhook   (or GET verify challenge)
      ▼
┌─────────────────┐
│  Go Ingress     │  HMAC-SHA256 verify, then Redis enqueue
│  port 8080      │  Fallback: proxy GET verify to Next.js for DB token
└────────┬────────┘
         │
         │ RPUSH whatsapp-webhooks
         ▼
┌─────────────────┐
│     Redis       │
└────────┬────────┘
         │ BLPOP
         ▼
┌─────────────────┐
│  Node Worker    │  src/scripts/queue-worker.ts
│                 │  retries 3x, then DLQ
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Next.js logic  │  processWebhook() → processMessage()
│  (webhook-      │  contact/conversation/message creation
│   handler.ts)   │  automations/flows/chatbot engine
└─────────────────┘
```

### Key files

| File | Responsibility |
|------|---------------|
| `src/lib/whatsapp/meta-api.ts` | Meta Graph API client (messages, templates, media, catalogs, registration) |
| `src/lib/whatsapp/webhook-handler.ts` | Main webhook processing business logic |
| `src/lib/whatsapp/webhook-signature.ts` | HMAC-SHA256 verification |
| `src/lib/whatsapp/encryption.ts` | AES-256-GCM token encryption/decryption |
| `src/lib/whatsapp/flow-crypto.ts` | Meta Flows RSA-OAEP + AES-GCM crypto handshake |
| `src/lib/whatsapp/meta-flow-service.ts` | Native Meta Flows lifecycle (create, publish, register keys) |
| `src/lib/whatsapp/preference-flow.ts` | Buyer preference intake native-flow blueprint |
| `src/lib/whatsapp/routing-engine.ts` | Message routing rules |
| `src/lib/whatsapp/owner-digest-template.ts` | Owner digest WhatsApp templates |
| `src/app/api/whatsapp/webhook/route.ts` | Next.js fallback webhook endpoint (also can enqueue to Redis) |
| `go-ingress/main.go` | Fast webhook ingress |
| `src/scripts/queue-worker.ts` | Redis queue consumer |
| `src/scripts/replay-dlq.ts` | Dead-letter queue recovery |

### Media handling

- Store only `mediaId` in `messages.media_id`.
- View via `/api/whatsapp/media/[mediaId]`, which fetches a fresh URL from Meta and streams it.
- Expired or forwarded media returns 404 with a `MEDIA_UNAVAILABLE` code.

---

## 10. API route patterns

- All API routes are `route.ts` files under `src/app/api/<resource>/`.
- Standard response shape:
  - Success: `{ data: ... }`
  - Error: `{ error: string, code?: string }`
- Auth-gated routes must call `supabase.auth.getUser()` at the top (via `createClient()` from `src/lib/supabase/server.ts`).
- Public routes are under `/api/public/`.
- Webhook routes are under `/api/whatsapp/webhook` and `/api/leads/email-webhook`.
- Cron routes are under `/api/cron/` and `/api/*/cron/`; they require `AUTOMATION_CRON_SECRET` or `CRON_SECRET`.
- Rate-limit sensitive public endpoints using `src/lib/rate-limit.ts`.

### Common patterns in routes

- Use `await createClient()` from `src/lib/supabase/server.ts` for the authenticated SSR client.
- Use an inline `createClient(url, serviceRoleKey)` for webhooks/background jobs that need RLS bypass.
- Parse and validate request bodies; never trust user input.
- Return early with `NextResponse.json({ error: ... }, { status: ... })` on errors.

---

## 11. Component and UI patterns

- Default to server components; add `"use client"` only when needed.
- Use Tailwind CSS for layouts; follow the dark glassmorphic aesthetic (`bg-slate-900/50 border border-slate-800 rounded-xl`).
- Use `cn()` from `src/lib/utils.ts` for conditional class merging.
- Use shadcn/ui primitives from `src/components/ui/`.
- Use Lucide icons from `lucide-react` only.
- Props interfaces are defined inline at the top of component files.
- Toasts use `sonner` (`Toaster` in `src/components/layout/themed-toaster.tsx`).
- The app supports five accent themes (violet, emerald, cobalt, amber, rose) and light/dark mode. Theme logic is in `src/hooks/use-theme.tsx` and `src/lib/themes.ts`.

---

## 12. Testing

- **Framework**: Vitest.
- **Unit tests**: `src/**/*.test.ts` / `src/**/*.test.tsx`. Run with `npm test`. They use dummy secrets and do not touch the network.
- **Integration tests**: `src/**/*.integration.test.ts`. Run with `npm run test:integration`. They hit the live Supabase project using `SUPABASE_SERVICE_ROLE_KEY` and skip if credentials are absent.
- **Go tests**: `cd go-ingress && go test`.
- **Husky pre-commit**: runs `npm test` (see `.husky/pre-commit`).
- Tests are co-located with source files.

---

## 13. Deployment

### Vercel (primary web app)

- `vercel.json` configures:
  - `ignoreCommand` to skip builds when only `go-ingress/`, `docs/`, `Dockerfile.worker`, or `mobile/` change.
  - `buildCommand`: `NEXT_PUBLIC_BUILD_ID=$(git rev-parse --short HEAD) next build`
  - Cron schedules (see `vercel.json`).
- `next.config.ts` sets:
  - Security headers (HSTS, CSP report-only, framing, referrer, permissions).
  - Cache-Control rules (immutable for `_next/static`, `no-store` for `/api/*`, brief s-maxage + SWR for pages).
  - Domain redirects via `REDIRECT_FROM_DOMAIN` / `REDIRECT_TO_DOMAIN`.

### Go ingress

Deploy `go-ingress/Dockerfile` to a container host (Railway, Render, etc.). Required env: `PORT`, `REDIS_URL`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `NEXT_PUBLIC_SITE_URL` (or `NEXTJS_BACKEND_URL`).

### Queue worker

Deploy `Dockerfile.worker` as a background daemon. Required env: `REDIS_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `GEMINI_API_KEY`, `NEXT_PUBLIC_SITE_URL`, plus branding defaults.

### Redis

Use Upstash, Redis Labs, or self-hosted Redis. Webhook queue key: `whatsapp-webhooks`. Dead-letter queue key: `whatsapp-webhooks-dlq`.

### Cron jobs

Defined in `vercel.json`:

- `/api/cron/cleanup-images` — daily 03:00 UTC
- `/api/cron/market-stats` — daily 21:30 UTC
- `/api/cron/owner-digest` — daily 04:30 UTC
- `/api/cron/deal-mode-matching` — daily 05:00 UTC
- `/api/cron/den-bids-expiry` — daily 05:30 UTC
- `/api/appointments/cron` — every 15 minutes

All cron routes require `AUTOMATION_CRON_SECRET` or `CRON_SECRET`.

---

## 14. Security considerations

- **Secrets**: Never log or commit secrets. The repository is not a sandbox; treat `.env.local` and service keys as sensitive.
- **Token encryption**: WhatsApp access tokens are encrypted with AES-256-GCM at rest. The `ENCRYPTION_KEY` must be a 64-character hex string (32 bytes).
- **Webhook signatures**: Always verify `X-Hub-Signature-256` with `META_APP_SECRET` before processing webhooks. The Go ingress does this; the Next.js fallback route also does it.
- **RLS**: Keep RLS enabled. Do not create service-role clients in client code. Even service-role routes must enforce `account_id` scoping.
- **Media proxy**: Never expose Meta media URLs directly; proxy through `/api/whatsapp/media/[mediaId]`.
- **CSP**: Currently report-only (`Content-Security-Policy-Report-Only`). Flip to enforce only after validating no violations across every route for at least two deploys.
- **Deep linking**: `.well-known/apple-app-site-association` and `.well-known/assetlinks.json` are generated from env vars `APPLE_TEAM_ID` and `ANDROID_APP_CERT_SHA256`.
- **Security reports**: See `.github/SECURITY.md`. Do not open public security issues.

---

## 15. Useful resources

| File | What it covers |
|------|---------------|
| `README.md` | Project overview, quick start, feature list |
| `ARCHITECTURE.md` | System architecture, design decisions, performance notes |
| `DATABASE_SCHEMA.md` | Table-by-table schema reference |
| `PROJECT_HANDOVER.md` | Recent milestones, key features, coding standards |
| `AI_ENGINEERING_CONSTITUTION.md` | Immutable rules for AI agents |
| `CONTRIBUTING.md` | Fork/PR workflow, dev-loop commands |
| `docs/production-deployment.md` | Step-by-step production deployment |
| `docs/scaling-architecture.md` | Scaling roadmap for 10k accounts/200M contacts |
| `docs/meta-ads-integration-plan.md` | Meta Ads OAuth and campaign integration |
| `docs/OWNERS_DEN_TESTING.md` | Owners Den testing checklist |
| `docs/CLOUDFLARE_EMAIL_SETUP.md` | Cloudflare email routing for portal leads |
| `CHANGELOG.md` | Recent changes and feature history |
| `ROADMAP.md` / `FEATURE_ROADMAP.md` | Upcoming features |

---

## 16. Quick checklist before submitting changes

- [ ] I read the relevant file(s) and surrounding context.
- [ ] I ran `npm run typecheck` and it passes.
- [ ] I ran `npm run lint` and it passes.
- [ ] I ran `npm run format` (or `format:check`) and it passes.
- [ ] I ran `npm test` and it passes.
- [ ] I did not add new dependencies unless they are already in use elsewhere.
- [ ] I did not add explanatory comments unless asked.
- [ ] I kept changes minimal and scoped to the requirement.
- [ ] I did not expose secrets or service-role keys in client code.
- [ ] New tables have `account_id`, RLS, triggers, and policies.
