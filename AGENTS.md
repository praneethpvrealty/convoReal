# ConvoReal — AI Agent Handbook

> This file is written for AI coding agents. It is a single source of truth for the project’s architecture, conventions, build/test commands, and security rules. Read it before editing code. If something here conflicts with project-specific docs, this file and the most specific doc (deepest path) win.

## Important: This is NOT the stock Next.js you trained on

Next.js 16 has breaking changes compared with older versions — APIs, file conventions, and behaviour differ from training data. Before writing code, read the relevant guide in `node_modules/next/dist/docs/` and heed any deprecation notices. Do not assume the patterns from Next.js 14/15 work unchanged.

---

## 1. What this project is

ConvoReal is a self-hostable **WhatsApp deal engine for real-estate brokerages**. It provides:

- Property inventory (50+ fields, images, documents, floor tenancies, RERA, AI-generated descriptions).
- Contact/lead management with classification, tags, custom fields, and matching preferences.
- Shared WhatsApp inbox via the Meta Cloud API (messages, templates, media, reactions).
- Sales pipelines (Kanban), deals, and journey mind-map.
- Broadcast campaigns, no-code automations, and interactive WhatsApp flows.
- Public showcase portal (branded property listings, buyer/agent modes, interest tracking, document requests) plus SEO listing pages (`/property/[slug]`, `/projects/[project]`, `/farmland/[destination]`).
- Email lead sync from MagicBricks / Housing.com / 99acres via IMAP webhooks, plus portal import via the Chrome extension in `extension/portal-autofill/`.
- Owner digests, agent inventory digests, buyer match digests, appointment reminders, calendar & to-dos.
- **Match Radar** — proactive contact↔property match events computed on top of `src/lib/matching.ts`.
- **Showcase Pulse** — engagement tracking for public showcase visits and shares.
- **Copilot** — the in-app AI helper (guided tours, rule-based nudges, semantic Q&A cache). See `src/lib/copilot/README.md`.
- **Liaisons** — a directory of service providers with jobs, workflows, and payments.
- **Listing media** — AI photo enhancement, generated listing videos (ffmpeg + Sarvam TTS), and YouTube upload.
- **Portfolio (owner side)** — the owner-facing portal (`/den`) for deal-mode matching, bids, and token-safe deal rooms. Customer-facing brand is **Portfolio**; code identifiers stay `den_*` (legacy code name, like the `crm.` redirect).
- **Portfolio (buyer side)** — the buyer-facing portal (`/buyer`) for preferences, matches, and shortlists. Same **Portfolio** brand; code identifiers stay `buyer_*`.
- **Mobile app** — an Expo/React Native companion app in `mobile/` (its own `AGENTS.md`, deps, and tests).

All tenant data lives in one Supabase PostgreSQL database and is isolated by `account_id` through Row-Level Security (RLS).

---

## 2. Non-negotiable rules (AI Engineering Constitution)

These rules are hard project conventions. Violating them will break the app or the security model.

The canonical constitution lives in the [ConvoReal Engineering OS](https://github.com/praneethpvrealty/ConvoReal-Engineering-OS) at `03_ENGINEERING/30_AI_ENGINEERING_CONSTITUTION.md` — a cross-project knowledge repo covering product, business, architecture, engineering, AI and operations. It is restated here rather than only linked: this file is loaded into agent context automatically, a remote repo is not. §2.1–2.8 are the ConvoReal-specific expansion of it. If the two disagree, the Engineering OS wins on intent and this file wins on ConvoReal specifics — update both.

Two canonical rules the subsections below do not otherwise restate:

- **Preserve existing functionality.** Do not rewrite a large module without approval; extend an existing pattern rather than replacing it.
- **Follow the golden workflow** — Analyze → Plan → Implement small change → Validate → Document → Commit — and summarize what changed and what the risks are.

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
| UI primitives | shadcn/ui (`base-nova` style) on `@base-ui/react` | Reuse `src/components/ui/`; do not duplicate |
| Icons | lucide-react | Do not import other icon libraries |
| Database | Supabase (PostgreSQL) | Every operational table must have `account_id` and RLS |
| Auth | Supabase Auth | `@supabase/ssr` for SSR; `useAuth()` for client |
| Client state | React Context + hooks | No Redux, Zustand, or other external state managers |
| Server cache | @tanstack/react-query | For anything fetched. Not a state manager — it owns loading/error/refetch and dedupes requests, which the rule above does not cover. Mobile already used it; web adopted it starting with the dashboard. Do not hand-roll a new `useEffect` + `fetch` + `useState` triple |
| Charts | Recharts | Do not add another chart library |
| Toasts | sonner | Used via `<Toaster>` in root layout |
| Dates | date-fns | No moment.js or dayjs |
| Drag & drop | @dnd-kit | Pipeline Kanban board |
| Flow builder | @xyflow/react (+ @dagrejs/dagre for layout) | Automations/flows/journey visual builders |
| Image processing | sharp | Server-side resize/encode; do not add another imaging lib |
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
- Aggregate in SQL, not in the browser. `count: 'exact'` is a real `COUNT(*)`, not a metadata read — several of them on one screen means several scans of the account's rows. Selecting rows to `reduce()` them client-side ships a payload that grows with account activity. Add a `SECURITY DEFINER` function that names its account and guards with `is_account_member()` (see migrations 168–170).
- Never interpolate a query result into a `.in()` / `.not('id','in', …)` filter without a bound — that list travels in the URL. Use a correlated `NOT EXISTS` inside a function instead.

### 2.7 WhatsApp rules

- Store `mediaId`, not Meta CDN URLs. Build viewing URLs via `/api/whatsapp/media/[mediaId]`.
- Only send UTILITY/MARKETING templates outside the 24-hour free-form window.
- Always check template status before sending; sync statuses via `POST /api/whatsapp/templates/sync`.
- Webhook payloads must be verified by `verifySignature()` from `src/lib/whatsapp/webhook-signature.ts` before processing.
- **A template's category is decided once and is unfixable.** Meta assigns it when the template first passes review, refuses to change it afterwards (`POST /<template_id>` with a new category returns "You cannot update an approved template category" and rejects the whole edit, content included), and reserves a deleted template's name for four weeks. Meta's public categorisation guide claims an approved category can be edited — the API disagrees; trust the API.
- **Never resubmit under a new name to chase a UTILITY category.** Four attempts at an agent digest (`agent_inventory_digest`, `agent_listing_activity_update`, `agent_property_digest`) all came back MARKETING, the last one near word-for-word identical to `owner_property_digest`, which holds UTILITY from an earlier approval. Content parity does not reproduce a category, and every attempt burns a name permanently. When a template is miscategorised, the only real options are: reuse an existing approved template whose params match, appeal in WhatsApp Manager (Business Support, within 60 days), or accept MARKETING and gate sends on explicit opt-in. See the header of `src/lib/whatsapp/agent-inventory-digest-template.ts`.

### 2.8 Web ↔ mobile feature parity

Web (`src/`) and mobile (`mobile/`) are two surfaces of one product, not two products. **Every user-facing feature must exist on both.** A feature shipped to only one surface is unfinished work, not a finished feature — and the gap is a defect to be closed, not a decision to be deferred.

- **Build both directions.** A new web feature must land on mobile; a new mobile feature must land on web. This applies to changes to existing features too — a field, filter, action, or state added on one surface is added on the other.
- **Put the logic where both can reach it.** Business rules belong in an API route under `src/app/api/` or in pure TypeScript under `src/lib/`. Only rendering, navigation, and platform affordances are written twice. Never fork a rule so that web and mobile can disagree about it. See `docs/GUIDE_MOBILE_APPLICATION_PORTABILITY.md` for how this split was drawn for Copilot; it is the pattern for everything else.
- **The mobile app is a client of the same API.** `src/lib/supabase/server.ts` already accepts mobile `Authorization: Bearer <jwt>` requests (§7.4). A route that only works with cookie sessions is a parity bug.
- **Do the mobile side in the same change** unless the surfaces genuinely diverge in effort. If mobile has to follow later, say so explicitly in the summary and record the gap in `FEATURE_ROADMAP.md` — do not leave it silent.
- **Ship both halves validated.** Root `npm run typecheck && npm run lint && npm test` covers web only; mobile has its own dependency tree and config. Run `cd mobile && npm run typecheck && npm run lint && npm test` whenever `mobile/**` changes, and read `mobile/AGENTS.md` first.
- **Legitimate single-surface exceptions**, which do not need a counterpart: browser-bound public surfaces (SEO listing pages, showcase portal, `/den` and `/buyer` portals, document viewer, invitation acceptance), the Chrome extension, the Go ingress and queue worker, admin/dev tooling, and native-only affordances (push tokens, camera, biometrics, deep-link handlers). Anything in the authenticated dashboard is not an exception.

---

## 3. Tech stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js >= 20 | `engines` in `package.json`; CI runs Node 20 |
| App server | Next.js 16.2.6 (App Router) | `next.config.ts` at project root |
| Language | TypeScript ^6 | `tsconfig.json` strict mode, `@/` alias |
| React | 19.2.4 | Server components by default |
| Styling | Tailwind CSS v4 | `@import "tailwindcss"` in `src/app/globals.css` |
| UI kit | shadcn/ui (`base-nova`) | `components.json` configures aliases and style |
| Icons | lucide-react | Only icon library used |
| Database | Supabase (PostgreSQL + RLS + Realtime) | `supabase/migrations/` and `supabase/RUN_IN_SUPABASE_SQL_EDITOR.sql` |
| Auth | Supabase Auth (GoTrue) | `@supabase/ssr` cookie-based SSR + mobile bearer-token support |
| Storage | Supabase Storage (S3-compatible) | Avatars, property images, documents |
| WhatsApp | Meta Cloud API v21.0 | `META_API_VERSION` in `src/lib/whatsapp/meta-api.ts` |
| AI | Google Gemini (3.x / 2.5 flash family + `gemini-embedding-001`) | Model ids live in `src/lib/ai/gemini.ts` — read them there, do not hardcode elsewhere |
| AI images | Gemini image models, Stability, Hugging Face | `src/lib/ai/image-gen.ts`; `GEMINI_IMAGE_MODEL` / `STABILITY_API_KEY` / `HF_ACCESS_TOKEN` |
| Listing video | ffmpeg + Sarvam TTS | `src/lib/video/listing-video-worker.ts` |
| Video publishing | YouTube Data API (Google OAuth) | `src/lib/youtube/`, `youtube_config` table |
| Queue | Redis | `ioredis` in Node, `go-redis` v9 in Go |
| Ingress | Go 1.24.3 | `go-ingress/main.go` + `Dockerfile` |
| Email | Resend | `src/lib/email.ts` |
| Payments | Razorpay + Stripe | `src/lib/marketplace/razorpay.ts`, `src/lib/credits/stripe.ts` |
| Maps | Google Places | `src/lib/maps/google-places.ts` |
| Cron | Vercel Cron | `vercel.json` |
| Analytics | Vercel Analytics | `@vercel/analytics` |
| CI | GitHub Actions | `.github/workflows/ci.yml` — path-filtered, tiered; see §12 |
| Mobile | Expo ~57 / React Native 0.86 / React 19.2.7 | `mobile/` directory, separate package.json and lockfile |
| Browser extension | Chrome portal autofill | `extension/portal-autofill/` |
| MCP server | @modelcontextprotocol/sdk (stdio) | `mcp/` directory, own package.json and lockfile; a client of `/api/v1` |

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
├── .github/workflows/ci.yml      # Path-filtered lint/typecheck/test; build at merge time
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
│   │   │   ├── today/            # Daily agenda
│   │   │   ├── radar/            # Match Radar events
│   │   │   ├── pulse/            # Showcase engagement feed
│   │   │   ├── requirements/     # Buyer requirements
│   │   │   ├── liaisons/         # Service-provider directory, jobs, workflows
│   │   │   ├── agents/           # Team/agent management
│   │   │   ├── ads/              # Meta Ads integration
│   │   │   ├── settings/         # Account settings
│   │   │   └── ...               # admin, dev (chatbot simulator), checkout-demo
│   │   ├── (den)/den/            # Owners Den portal (own login + phone verification)
│   │   ├── (buyer)/buyer/        # Buyer portal (own login + phone verification)
│   │   ├── api/                  # REST API routes (route.ts files)
│   │   ├── property/[slug]/      # Public SEO listing page
│   │   ├── projects/[project]/   # Public project page
│   │   ├── farmland/[destination]/ # Public farmland landing page
│   │   ├── docs/[token]/         # Public document viewer
│   │   ├── join/[token]/         # Invitation acceptance
│   │   ├── list/                 # Public listing referral page
│   │   ├── verify-phone/         # Phone verification
│   │   ├── profile-setup/        # Post-signup onboarding
│   │   ├── .well-known/          # apple-app-site-association, assetlinks.json
│   │   ├── page.tsx              # Landing / showcase page
│   │   ├── layout.tsx            # Root layout + theme boot script
│   │   └── globals.css           # Tailwind v4 + theme tokens
│   ├── components/               # React components by domain
│   │   ├── ui/                   # shadcn/ui primitives
│   │   ├── tremor/               # Chart/stat primitives used by dashboard widgets
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
│   │   ├── copilot/              # In-app AI helper, tours, nudges
│   │   ├── den/                  # Owners Den UI
│   │   ├── buyer/                # Buyer portal UI
│   │   ├── liaisons/             # Liaison directory UI
│   │   └── ...                   # chat, documents, journey, landing, onboarding, pulse, radar
│   ├── hooks/                    # Custom React hooks (auth, RBAC, realtime, theme, credits, plan…)
│   ├── lib/                      # Business logic & utilities
│   │   ├── supabase/             # Client factories (client.ts, server.ts, admin.ts)
│   │   ├── whatsapp/             # Meta API, webhooks, templates, encryption, flows, digests
│   │   ├── ai/                   # Gemini integration, chatbot engine, intake, image gen
│   │   ├── automations/          # Automation execution engine
│   │   ├── flows/                # Interactive flow engine
│   │   ├── bot/                  # WhatsApp funnels + catalog matching
│   │   ├── copilot/              # Intent matching, tours, nudges, Q&A cache (see its README)
│   │   ├── auth/                 # Auth helpers, RBAC, invitations
│   │   ├── contacts/             # Contact helpers
│   │   ├── inventory/            # Property helpers, flyers, project slugs
│   │   ├── matching.ts           # Contact-property matching engine
│   │   ├── radar/                # Match Radar engine + queries
│   │   ├── pulse/                # Showcase engagement tracker + queries
│   │   ├── buyer/                # Buyer portal auth, preferences, matches, digests
│   │   ├── den/                  # Owners Den logic (bids, masking, token-safe)
│   │   ├── liaisons/             # Liaison services, jobs, workflows
│   │   ├── dashboard/, today/    # Screen-level data queries
│   │   ├── market/               # Market stats engine
│   │   ├── portals/, portal-import/ # Portal post kits, listing import/matching
│   │   ├── video/, pdf/, youtube/   # Listing video, PDF extraction, YouTube upload
│   │   ├── seo/                  # JSON-LD builders
│   │   ├── showcase/             # Public catalog data, QA, slugs
│   │   ├── billing/, credits/, marketplace/ # Plans, credit wallet, Razorpay/Stripe
│   │   ├── notifications/        # In-app + push notifications
│   │   ├── storage/              # Uploads, image cleanup
│   │   ├── email/, email.ts      # Resend wrapper + IMAP lead sync
│   │   ├── maps/                 # Google Places proxy
│   │   ├── data/                 # Static/locality data
│   │   ├── rate-limit.ts         # Fixed-window limiter: Redis when REDIS_URL is set, in-memory otherwise
│   │   └── utils.ts              # `cn()` Tailwind merge helper
│   ├── scripts/                  # Background workers and admin scripts
│   │   ├── queue-worker.ts       # Redis consumer for WhatsApp webhooks
│   │   ├── replay-dlq.ts         # Replay dead-letter queue
│   │   ├── reconcile-property-pins.ts
│   │   ├── backfill-property-coords.ts
│   │   └── ...
│   ├── types/                    # Shared TypeScript definitions (`src/types/index.ts`)
│   └── proxy.ts                  # Auth-redirect helper (unit tested; not wired as Next.js middleware)
├── go-ingress/                   # Standalone Go webhook ingress
│   ├── main.go                   # HMAC verify + Redis enqueue
│   ├── main_test.go              # Go tests
│   ├── Dockerfile                # Multi-stage Alpine build
│   ├── go.mod / go.sum           # Go 1.24.3, go-redis v9
├── supabase/
│   ├── migrations/               # 186 numbered SQL migrations (001–174, with gaps/collisions)
│   └── RUN_IN_SUPABASE_SQL_EDITOR.sql  # Consolidated schema seed
├── docs/                         # Deployment, scaling, integration and design guides
├── mobile/                       # Expo React Native app (own package.json + AGENTS.md)
├── mcp/                          # MCP server (own package.json + README); a client of /api/v1
└── extension/portal-autofill/    # Chrome extension
```

### Codebase size (rough)

- `src/app`: ~317 files — 60 `page.tsx` and 209 `route.ts`.
- `src/components`: ~212 files.
- `src/lib`: ~303 files.
- `src/**/*.test.ts(x)`: ~118 test files.
- `supabase/migrations`: 186 SQL files.

These numbers drift with every feature. Re-count rather than trusting them if a decision depends on the exact figure.

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
| `npm run reconcile-pins` | Reconcile property map pins with derived coordinates. |

CI (`.github/workflows/ci.yml`) is tiered. A `changes` job classifies the diff, then `lint`, `typecheck` and `test` run in parallel whenever web paths changed, and the `mobile` job runs only when `mobile/**` changed. `build` is deliberately **not** run on pull requests — Vercel already builds every push and `typecheck` covers the same type errors — so it runs on `merge_group` and `push: main` only, with `.next/cache` restored between runs. `ci` is an `if: always()` gate job and is the single status check to mark required; do not require the individual jobs, since a skipped job never reports. Run the same commands locally before pushing.

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
| `cd mobile && npm test` | Vitest over the mobile app's pure logic (`mobile/lib/**/*.test.ts`). |

### MCP server

Run from `mcp/`:

| Command | What it does |
|---------|-------------|
| `cd mcp && npm install` | Install MCP server dependencies. |
| `cd mcp && npm run build` | Compile to `dist/`. Required before a client can launch it. |
| `cd mcp && npm run typecheck` | TypeScript check for the MCP package. |
| `cd mcp && npm test` | Vitest: a real MCP client over an in-memory transport against an HTTP stub of `/api/v1`. |
| `cd mcp && npm run dev` | tsx watch. |

Read `mcp/README.md` before touching `mcp/`. The package is excluded from the root `tsconfig.json`, ESLint config and Vercel build, so root validation does not cover it.

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
| `GOOGLE_MAPS_API_KEY` | Google Places / Maps API key (server-side) |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Referrer-restricted Maps JavaScript API key for the Inventory map view; without it the map degrades to a hint panel |
| `RESEND_API_KEY` | Resend API key for transactional emails |
| `RESEND_FROM_EMAIL` | Sender email address (defaults to `noreply@convoreal.com`) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay credentials |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signature secret |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe credentials for credit top-ups |
| `META_ADS_APP_ID` / `META_ADS_APP_SECRET` | Meta Ads integration (feature-flagged by `META_ADS_ENABLED=true`) |
| `NEXT_PUBLIC_META_ADS_APP_ID` | Public Meta Ads App ID (controls UI visibility) |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASSWORD` / `IMAP_SECURE` | IMAP email lead sync |
| `LEADS_WEBHOOK_TOKEN` | Secret for `/api/leads/email-webhook`; also the bearer token for the Cloudflare worker's ledger API |
| `LEADS_WORKER_URL` | Cloudflare email worker URL, polled by `/api/cron/lead-sync-reconcile` to re-ingest leads the push path dropped |
| `AUTOMATION_CRON_SECRET` / `CRON_SECRET` | Secret required by cron/endpoint routes |
| `SUPABASE_SMS_HOOK_SECRET` | Secret for `/api/auth/sms-hook` (WhatsApp OTP) |
| `TOKEN_SAFE_WEBHOOK_SECRET` | Secret for the token-safe escrow webhook |
| `HF_ACCESS_TOKEN` / `HF_IMAGE_URL` | Hugging Face token and endpoint for image generation |
| `GEMINI_IMAGE_MODEL` | Override the Gemini image model id |
| `STABILITY_API_KEY` / `STABILITY_MODEL` | Stability credentials for AI photo enhancement |
| `SARVAM_API_KEY` / `SARVAM_API_BASE` / `SARVAM_SPEAKER` | Sarvam TTS for generated listing videos |
| `FFMPEG_PATH` / `VIDEO_FONT_PATH` | ffmpeg binary and font used by the listing-video worker |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth for YouTube upload |
| `ALLOWED_INVITE_HOSTS` | Allow-list of hosts accepted in invitation redirect links |
| `CONVOREAL_MASTER_ACCOUNT_ID` | Master account used by admin/marketplace tooling |
| `NEXT_PUBLIC_LEADS_EMAIL_DOMAIN` | Domain shown for per-account portal lead email addresses |
| `PUBLIC_API_KEY` | API key for the public API surface |
| `WHATSAPP_TEMPLATES_DRY_RUN` | Skip real template submissions to Meta when set |
| `NEXT_PUBLIC_APP_URL` | Optional alias for the app URL (fallback for `NEXT_PUBLIC_SITE_URL`) |
| `NEXT_PUBLIC_BASE_DOMAIN` | Base domain for branding/subdomain logic (default `convoreal.com`) |
| `NEXT_PUBLIC_DEFAULT_WEBSITE_NAME` | Default site name (default `ConvoReal`) |
| `NEXT_PUBLIC_DEFAULT_WEBSITE_URL` | Default website URL (default `https://www.convoreal.com`) |
| `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` | Default phone country code (default `91`) |
| `NEXT_PUBLIC_DEFAULT_ACCOUNT_ID` | Default account for the public showcase landing page |
| `NEXT_PUBLIC_ENGINE_VERTICAL` | Active vertical (default `real_estate`) |
| `NEXT_PUBLIC_COPILOT_ENABLED` | Copilot feature flag (default `true`) |
| `NEXT_PUBLIC_CONVOREAL_SALES_WHATSAPP` | Sales WhatsApp number for landing-page fallback |
| `NEXT_PUBLIC_BUILD_ID` | Git short SHA; injected by Vercel build command in `vercel.json` |
| `REDIRECT_FROM_DOMAIN` / `REDIRECT_TO_DOMAIN` | Domain redirect rules in `next.config.ts` |
| `APPLE_TEAM_ID` / `ANDROID_APP_CERT_SHA256` | Deep-link / app-link configuration files |

The authoritative list is the code, not this table. To re-derive it:

```bash
grep -rhoE 'process\.env\.[A-Z_0-9]+' src go-ingress | sed 's/process\.env\.//' | sort -u
```

The mobile app uses its own `EXPO_PUBLIC_*` variables (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`).

### Credentials in an agent session: check the environment, not `.env.local`

**A missing `.env.local` does not mean there are no credentials.** In a hosted agent session (Claude Code on the web, CI, a container) the secrets are exported into the process environment directly, and no `.env.local` file exists at all. `dotenv.config({ path: '.env.local' })` at the top of every script in `src/scripts/` is a no-op there and is *meant* to be — `process.env` is already populated.

So before reporting that a script cannot be run, check what is actually set:

```bash
printenv | cut -d= -f1 | grep -Ei 'SUPABASE|ENCRYPTION|META_|GEMINI' | sort
```

Never echo the values. Two things this session's environment gets wrong in a way worth knowing:

- `SUPABASE_SERVICE_ROLE_KEY` and `ENCRYPTION_KEY` are present; `NEXT_PUBLIC_SUPABASE_URL` is **not**. The session carries `SUPABASE_DB_URL` instead, so scripts that construct a Supabase JS client need the project URL supplied: `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co npx tsx src/scripts/<script>.ts`.
- The Supabase MCP connection runs as the service role with no `auth.uid()`, so any `SECURITY DEFINER` function guarded by `is_account_member()` returns **zero rows** when called through it. That is the guard working, not a broken function — verify such functions against their underlying tables instead.

### Vitest dummy secrets

`vitest.config.ts` stubs `ENCRYPTION_KEY` and `META_APP_SECRET` so unit tests run without `.env.local`. CI sets the same placeholders plus dummy public Supabase values so `next build` succeeds. Integration tests load real credentials from `.env.local` and skip if absent.

---

## 7. Database and migrations

### 7.1 Schema source

- **Incremental migrations**: `supabase/migrations/NNN_description.sql` (186 files, numbered roughly 001–174 with some gaps and collisions — e.g. two `063_*` and two `173_*` files). Pick the next free number by listing the directory, and expect duplicates to already exist.
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
| Tenancy | `accounts`, `profiles`, `teams`, `account_invitations`, `account_lifecycle_log` |
| Contacts | `contacts`, `tags`, `contact_tags`, `custom_fields`, `contact_custom_values`, `contact_notes`, `contact_call_logs`, `contact_draft_sessions`, `contact_merge_log` |
| Properties | `properties`, `showcase_settings`, `rera_projects`, `property_document_requests`, `property_draft_sessions`, `property_likes`, `property_ratings`, `property_shares`, `property_portal_listings` |
| WhatsApp | `conversations`, `messages`, `message_reactions`, `message_templates`, `whatsapp_config`, `whatsapp_meta_flows`, `whatsapp_meta_flow_sessions`, `whatsapp_reply_bridges`, `routing_rules` |
| Pipelines | `pipelines`, `pipeline_stages`, `deals` |
| Calendar | `appointments`, `appointment_reminder_log`, `todos` |
| Automations | `automations`, `automation_steps`, `automation_logs`, `automation_pending_executions` |
| Flows | `flows`, `flow_nodes`, `flow_runs`, `flow_run_events` |
| Journey | `journey_stages`, `journey_items`, `journey_events` |
| Owners Den | `den_users`, `den_contact_links`, `match_events`, `den_match_unlocks`, `property_bids`, `property_bid_events`, `deal_rooms`, `token_escrows` |
| Buyer portal | `buyer_users`, `buyer_contact_links`, `buyer_shortlist_items`, `buyer_match_digest_log` |
| Liaisons | `liaisons`, `liaison_jobs`, `liaison_workflows`, `liaison_job_payments` |
| Digests | `owner_digest_settings`, `owner_digest_log`, `agent_inventory_digest_settings`, `agent_inventory_digest_log`, `agent_digest_log` |
| Marketing | `broadcasts`, `broadcast_recipients`, `contact_property_inquiries`, `showcase_events`, `showcase_share_links`, `public_listing_submissions` |
| Lead sources | `email_sync_configs`, `email_sync_logs`, `portal_accounts`, `portal_import_items`, `ad_campaigns`, `meta_ads_config`, `ctwa_referrals` |
| Billing | `subscriptions`, `subscription_events`, `credit_wallets`, `credit_transactions`, `credit_packages`, `credit_package_prices`, `razorpay_orders`, `referrals`, `marketplace_items`, `marketplace_item_nodes`, `account_marketplace_items` |
| Platform | `notifications`, `notification_devices`, `notification_preferences`, `copilot_qa_cache`, `ai_call_log`, `market_stats`, `image_cleanup_log`, `youtube_config`, `update_sessions` |

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

### 8.3 Non-staff personas (Owners Den, Buyer portal)

Den and buyer users are `auth.users` rows with **no `profiles` row**, so every Engine RLS policy denies them by construction. Their data reaches them only through `/api/den/*` and `/api/buyer/*` handlers, which:

1. Resolve a `DenContext` / `BuyerContext` via `withDenAuth()` (`src/lib/den/auth.ts`) or `withBuyerAuth()` (`src/lib/buyer/auth.ts`).
2. Query with the service-role client under **explicit** owner/buyer scoping (`ctx.links`, `resolveOwnerPropertyIds(ctx)`, shortlist rows).

That explicit scoping *is* the security boundary for these routes — RLS is not doing it for you. Never return service-role results from a Den or buyer handler without filtering through the context. Both personas require WhatsApp phone verification before the context is considered complete.

### 8.4 Auth gating (no Next.js middleware.ts)

There is **no `middleware.ts`** in the project. Auth gating is handled by:

- Server-side checks in each API route.
- Client-side checks in layouts/components (e.g. `AuthProvider`, `DashboardShell`).
- `src/proxy.ts` is an exported helper function that is unit tested, but it is **not wired as automatic Next.js middleware**.

If you add a `middleware.ts`, keep the same rules as `proxy.ts` — especially the exemption for `/api/whatsapp/flows/endpoint/[accountId]` (Meta calls it without a browser session, using its own HMAC + RSA/AES crypto).

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
| `src/lib/whatsapp/reply-bridge.ts` | Direct replies: agent pings are answerable from the agent's own WhatsApp |
| `src/lib/whatsapp/customer-window.ts` | 24-hour free-form window bookkeeping |
| `src/lib/whatsapp/template-*.ts` | Template build, validation, status normalisation, lifecycle, webhooks |
| `src/lib/whatsapp/ctwa-attribution.ts` | Click-to-WhatsApp ad attribution |
| `src/lib/whatsapp/*-digest-template.ts` | Owner, agent-inventory and property-alert digest templates |
| `src/lib/bot/funnels.ts` | WhatsApp funnel + catalog-match conversation logic |
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
- Public routes are under `/api/public/` (showcase catalog, inquiries, documents, requirements, likes/ratings, AI Q&A).
- Den and buyer routes live under `/api/den/` and `/api/buyer/` and use `withDenAuth()` / `withBuyerAuth()` — see §8.3.
- The `/api/v1/` surface is authenticated by a per-account API key, not a Supabase session. Routes wrap `withApiKeyAuth(scope, handler)` from `src/lib/auth/api-keys.ts` and query through `ctx.db`, a service-role client — so **every query must carry `.eq('account_id', ctx.accountId)` in code**. That explicit scoping is the security boundary, exactly as for Den and buyer routes (§8.3); RLS is not doing it. Shared paging, filter parsing and row projections live in `src/lib/v1/`. Never add a WhatsApp-sending, billing, credits or member-management route to this surface — `mcp/README.md` records why the boundary is drawn there.
- Webhook routes are under `/api/whatsapp/webhook`, `/api/leads/email-webhook`, and `/api/webhooks/*` (Razorpay, Stripe, token-safe).
- Cron routes are under `/api/cron/` and `/api/*/cron/`; they require `AUTOMATION_CRON_SECRET` or `CRON_SECRET`.
- Rate-limit sensitive public endpoints using `src/lib/rate-limit.ts`.

### Common patterns in routes

- Use `await createClient()` from `src/lib/supabase/server.ts` for the authenticated SSR client.
- Auth-gated routes resolve the caller with `getCurrentAccount()` / `requireRole(min)` from `src/lib/auth/account.ts`, and report failures with `toErrorResponse(err)`. Do not hand-roll `auth.getUser()` plus a `profiles` lookup — that path skips the archived-account block and the role check. If a route's `catch` maps failures onto a domain error, resolve auth outside that `try` so a 401/403 is not reported as a send failure.
- Use `supabaseAdmin()` from `src/lib/supabase/admin.ts` for webhooks/background jobs that need RLS bypass. Do not declare a local service-role singleton.
- Parse and validate request bodies; never trust user input.
- Return early with `NextResponse.json({ error: ... }, { status: ... })` on errors.

---

## 11. Component and UI patterns

- Default to server components; add `"use client"` only when needed.
- Use Tailwind CSS for layouts; follow the dark glassmorphic aesthetic (`bg-slate-900/50 border border-slate-800 rounded-xl`).
- Use `cn()` from `src/lib/utils.ts` for conditional class merging.
- Use shadcn/ui primitives from `src/components/ui/`; charts and stat tiles reuse `src/components/tremor/`.
- Use Lucide icons from `lucide-react` only.
- Props interfaces are defined inline at the top of component files.
- Toasts use `sonner` (`Toaster` in `src/components/layout/themed-toaster.tsx`).
- The app supports six accent themes (violet, emerald, cobalt, amber, rose, verdant) and light/dark mode. Violet is the brand default on web and mobile alike; the others recolour a customer's workspace and never the logo. Theme logic is in `src/hooks/use-theme.tsx` and `src/lib/themes.ts`.

---

## 12. Testing

- **Framework**: Vitest.
- **Unit tests**: `src/**/*.test.ts` / `src/**/*.test.tsx`. Run with `npm test`. They use dummy secrets and do not touch the network.
- **Integration tests**: `src/**/*.integration.test.ts`. Run with `npm run test:integration`. They hit the live Supabase project using `SUPABASE_SERVICE_ROLE_KEY` and skip if credentials are absent.
- **Mobile tests**: `mobile/lib/**/*.test.ts`. Run with `cd mobile && npm test` (separate Vitest config and dependency tree). Pure logic only — modules that import Supabase, Expo or React Native have no runtime under a plain Node runner.
- **MCP server tests**: `mcp/src/**/*.test.ts`. Run with `cd mcp && npm test` (separate Vitest config and dependency tree, like mobile). They stand up a real HTTP server as `/api/v1` and drive the real MCP server through a real client, so nothing but the app itself is mocked.
- **Go tests**: `cd go-ingress && go test`.
- **Husky pre-commit**: runs `eslint` and `vitest related` over staged `src/**` TypeScript only (see `.husky/pre-commit`). The full suite is CI's job.
- **CI**: `.github/workflows/ci.yml` runs on every PR, on `merge_group`, and on push to `main`; older runs for the same PR branch are cancelled, merge-queue and main runs are not.
- **`main` is gated by the "main protection" ruleset**: a pull request is required (0 approvals), `CI` must pass, force pushes and deletions are blocked. `CI` is the gate job, not a real check — require it and never the individual jobs, which skip legitimately.
- **The `merge_group` trigger never fires today.** GitHub's merge queue needs an organization-owned repository and this one is user-owned, so the trigger is inert until that changes. `push: main` is therefore load-bearing, not redundant: do not remove it.
- **A push to `main` is not a per-commit guarantee.** Main runs share one concurrency group and GitHub keeps at most one pending run in it, so a rapid second merge cancels the first commit's queued run before any job starts. The PR-level `CI` gate is what actually covers every change.
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
- `/api/cron/agent-inventory-digest` — daily 04:45 UTC
- `/api/cron/deal-mode-matching` — daily 05:00 UTC
- `/api/cron/den-bids-expiry` — daily 05:30 UTC
- `/api/cron/buyer-match-digest` — daily 05:45 UTC
- `/api/cron/lead-sync-reconcile` — hourly at :10
- `/api/appointments/cron` — every 15 minutes
- `/api/cron/voice-campaigns` — every 10 minutes

All cron routes require `AUTOMATION_CRON_SECRET` or `CRON_SECRET`.

---

## 14. Security considerations

- **Secrets**: Never log or commit secrets. The repository is not a sandbox; treat `.env.local` and service keys as sensitive.
- **Token encryption**: WhatsApp access tokens are encrypted with AES-256-GCM at rest. The `ENCRYPTION_KEY` must be a 64-character hex string (32 bytes).
- **Webhook signatures**: Always verify `X-Hub-Signature-256` with `META_APP_SECRET` before processing webhooks. The Go ingress does this; the Next.js fallback route also does it.
- **RLS**: Keep RLS enabled. Do not create service-role clients in client code. Even service-role routes must enforce `account_id` scoping.
- **Media proxy**: Never expose Meta media URLs directly; proxy through `/api/whatsapp/media/[mediaId]`.
- **Rate limiting**: `src/lib/rate-limit.ts` is a fixed-window counter, backed by Redis when `REDIS_URL` is set and by an in-process Map otherwise. `checkRateLimit()` is **async** — every call site must `await` it, and TypeScript enforces that (`RateLimitResult` and `Promise<RateLimitResult>` are not interchangeable at `.success` or at `rateLimitResponse`). The Redis path does INCR + expiry in one Lua script, so instances racing on the first request of a window cannot both set the TTL. When Redis fails it falls back to the in-process counter rather than failing open or closed: a weaker limit beats either removing the limit during an incident or 429-ing the whole product because a cache is down. Without `REDIS_URL` — local dev, the test suite — behaviour is exactly as it was before. Each rate-limited request costs one Redis command; check the Upstash budget in `docs/external-services-audit.md` before adding the limiter to a high-traffic endpoint.
- **CSP**: Currently report-only (`Content-Security-Policy-Report-Only`). Flip to enforce only after validating no violations across every route for at least two deploys.
- **Deep linking**: `.well-known/apple-app-site-association` and `.well-known/assetlinks.json` are generated from env vars `APPLE_TEAM_ID` and `ANDROID_APP_CERT_SHA256`.
- **Security reports**: See `.github/SECURITY.md`. Do not open public security issues.

---

## 15. Useful resources

| File | What it covers |
|------|---------------|
| [ConvoReal Engineering OS](https://github.com/praneethpvrealty/ConvoReal-Engineering-OS) | Cross-project knowledge repo: foundation, business, architecture, engineering, AI, governance (ADRs), operations, templates. `INDEX.md` lists every document. Source of the constitution restated in §2 |
| `README.md` | Project overview, quick start, feature list |
| `DATABASE_SCHEMA.md` | Table-by-table schema reference |
| `PROJECT_HANDOVER.md` | Recent milestones, key features, coding standards |
| `CONTRIBUTING.md` | Fork/PR workflow, dev-loop commands |
| `CHANGELOG.md` | Recent changes and feature history — the best record of current behaviour |
| `FEATURE_ROADMAP.md` / `IMPLEMENTATION_PLAN.md` | Upcoming features and in-flight plans |
| `mobile/AGENTS.md` | Rules for the Expo app — read it before touching `mobile/` |
| `src/lib/copilot/README.md` | Copilot module: tours, nudges, cost model |
| `docs/production-deployment.md` | Step-by-step production deployment |
| `docs/scaling-architecture.md` / `docs/scaling-costs.md` | Scaling roadmap and cost model |
| `docs/external-services-audit.md` | Every third-party service, its tier, its limits, and the launch upgrade order |
| `docs/ultimate-whatsapp-onboarding-guide.md` / `docs/meta-onboarding-guide.md` | WhatsApp/Meta onboarding |
| `docs/meta-ads-integration-plan.md` | Meta Ads OAuth and campaign integration |
| `docs/embedded-signup-plan.md` | Embedded Signup + Coexistence onboarding plan (one-click WABA, same-number app+API) |
| `docs/property-intake-consolidation.md` | Every way a property gets in, and which one to hand to people outside the brokerage |
| `docs/OWNERS_DEN_TESTING.md` | Owners Den testing checklist |
| `docs/CLOUDFLARE_EMAIL_SETUP.md` / `docs/cloudflare-waf.md` | Cloudflare email routing and WAF |
| `docs/GUIDE_MOBILE_APPLICATION_PORTABILITY.md` | Web/native split for shared features |
| `docs/ai-photo-enhancement.md` / `docs/credits-policy-listing-video.md` / `docs/credits-policy-voice-campaign-call.md` | AI media/voice features and their credit policy |
| `docs/youtube-integration-setup.md` | YouTube OAuth and upload setup |
| `docs/domain-rehosting-guide.md` / `docs/region-migration-mumbai.md` | Domain and region migrations |
| `docs/refactoring-audit.md` | Known debt and refactor targets |
| `.github/SECURITY.md` | Vulnerability reporting policy |

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
- [ ] The feature exists on both web and mobile (§2.8), or the gap is stated in my summary and recorded in `FEATURE_ROADMAP.md`.
- [ ] If I touched `mobile/**`, I ran `cd mobile && npm run typecheck && npm run lint && npm test`.
