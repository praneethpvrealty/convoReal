# ConvoReal — WhatsApp Engine for Real Estate

> Self-hostable WhatsApp Engine purpose-built for Indian real estate agents and brokerages. Property inventory, lead management, sales pipeline, broadcast campaigns, automations, and a branded public showcase portal — all integrated with the WhatsApp Business API.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)
[![Go](https://img.shields.io/badge/Ingress-Go_1.24-00ADD8?logo=go)](https://go.dev)

---

## What you get

**WhatsApp Business API Engine** with a real estate vertical:

- **Property inventory** — 50+ fields (sale/rent, commercial/residential/land, dimensions, RERA, documents, images). AI-generated descriptions and images. Owner/agent listing source tracking.
- **Lead ingestion** — WhatsApp inbound, email sync from MagicBricks / Housing.com / 99acres, manual entry. Portal-specific parsing, property matching, automatic tagging.
- **Public showcase portal** — Branded property listing page with filters, inquiry forms, interest tracking, document requests, and co-broker agent mode (`?mode=agent`).
- **Shared inbox** on the official WhatsApp Business API — multiple agents working one number, conversation status, unread tracking, message reactions, template sending.
- **Contacts + tags + custom fields** — Classification (Owner/Seller/Buyer/Agent/Developer), lead temperature, budget/preferences/ROI tracking, CSV import, referral tracking.
- **Sales pipelines** (Kanban) with deals linked to contacts and properties, brokerage tracking.
- **Broadcasts** with Meta-approved templates, delivery + read tracking, per-recipient variable substitution.
- **No-code automations + interactive flows** — Triggers on inbound messages, new contacts, keywords, or schedule. Branching, waits, webhooks. Visual flow builder for WhatsApp menu trees.
- **Real-time dashboard** — Response times, daily volume, pipeline value, activity feed.
- **Team collaboration** — Multi-tenant accounts with role-based access (owner/admin/agent/viewer). Invitation-based onboarding.
- **Property sharing** — Interactive WhatsApp share with "Show More Properties" and "Browse All". Co-broker sharing with agent-mode links.
- **Requirement sharing** — Send a client brief to another brokerage, masked under a `REQ-` code. The link opens a page where they submit a matching listing, or they reply on WhatsApp quoting the code and the intake bot walks them through it. Either route lands a Pending Review property tied back to the requirement.
- **WhatsApp update sessions** — Contacts can update property or contact info by texting "update property PROP-1018" directly on WhatsApp.
- **Gated document sharing** — Secure token-based document access with approval workflow and 48h expiry.
- **Calendar & appointments** — Site visit scheduling with automated WhatsApp reminders (24h + 2h).

---

## Architecture

```
Meta Webhooks ──→ Go Ingress (port 8080) ──→ Redis Queue ──→ Node Worker
                       │                              (scripts/queue-worker.ts)
                  (HMAC-SHA256
                   verification)
                                            Next.js Server
                       │                    (API routes + pages)
                       │                              │
                       └── (verify fallback) ──────────┘
                                                       │
                                                  Supabase
                                             (Postgres + Auth
                                              + Storage)
```

| Layer | Technology | Role |
|---|---|---|
| **Webhook ingress** | Go 1.24 (`go-ingress/main.go`) | HMAC-SHA256 verification, Redis fan-out, Dockerized (7MB binary) |
| **Queue** | Redis | Webhook buffer, dead-letter queue recovery |
| **App server** | Next.js 16 (App Router) | SSR pages, REST API, business logic |
| **Database** | Supabase (PostgreSQL + RLS) | Multi-tenant data, auth, storage, realtime |
| **AI** | Google Gemini 2.5 / Imagen 4.0 | Property descriptions, image generation, chatbot |
| **Messaging** | Meta WhatsApp Cloud API v21 | Send/receive messages, templates, media |

---

## Quick start

```bash
git clone <your-repo-url>
cd convoreal
npm install
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm run dev
```

Open http://localhost:3000. You'll be redirected to `/login`.

### Required environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin access |
| `ENCRYPTION_KEY` | 64-char hex for AES-256-GCM token encryption |
| `META_APP_SECRET` | WhatsApp webhook HMAC verification |

### Supabase migrations

Apply migrations from `supabase/migrations/` in order (001–063) in the Supabase SQL Editor. Every table has Row-Level Security with `account_id` tenant isolation.

---

## Project structure

```
src/                          # Next.js application
├── app/                      # Pages + API routes
│   ├── (auth)/               # Login, signup, forgot-password
│   ├── (dashboard)/          # Dashboard, inbox, inventory, pipelines, etc.
│   └── api/                  # REST endpoints
├── components/               # UI components by domain
│   ├── inventory/            # Property forms, share dialogs, flyer creator
│   ├── inbox/                # WhatsApp chat, message bubbles, composer
│   ├── showcase/             # Public property showcase viewer
│   ├── pipelines/            # Kanban board, deal cards
│   ├── settings/             # All settings panels
│   ├── ui/                   # shadcn/ui primitives
│   └── ...
├── lib/                      # Business logic
│   ├── whatsapp/             # Meta API client, webhooks, templates, encryption
│   ├── ai/                   # Gemini chatbot engine
│   ├── automations/          # Automation execution engine
│   ├── flows/                # Interactive flow engine
│   ├── matching.ts           # Contact-property matching
│   └── supabase/             # Client factories
├── hooks/                    # useAuth, useTheme, useCan (RBAC)
├── scripts/                  # Background workers
│   ├── queue-worker.ts       # Redis consumer for webhook processing
│   └── replay-dlq.ts         # Dead letter queue recovery
└── proxy.ts                  # Auth redirect middleware

go-ingress/                   # Go webhook ingress (standalone, Dockerized)
├── main.go                   # HMAC verification + Redis enqueue
├── main_test.go              # Tests
├── Dockerfile                # Multi-stage Alpine build
└── go.mod / go.sum

supabase/migrations/          # Database migrations (001–063)
docs/                         # Deployment guides, architecture docs
```

---

## Key features in detail

### Property showcase

A branded public portal at the root URL (`/`) with:
- Category filters (Residential, Commercial, Land), bedroom/price/sort controls
- Property detail modal with image gallery, specs, map, nearby highlights
- WhatsApp click-to-chat inquiries with auto-generated messages
- Interest tracking (thumbs up/down) with localStorage persistence
- **Agent mode** (`?mode=agent`): hides inquiry forms and interest buttons for co-broker sharing
- Meta Pixel tracking (ViewContent, Search, Lead, Contact, ShareProperty)
- Configurable branding via showcase settings (logo, colors, currency, subdomain)

### Email lead sync (MagicBricks, Housing.com, 99acres)

Incoming portal emails are parsed by portal-specific extractors that:
- Extract name, phone, email, requirement
- Match property details against published inventory (scored matching)
- Auto-create contacts with source tracking and automatic tagging
- Send WhatsApp auto-replies using approved templates (24h window-aware)
- Log all actions to email sync audit log

### WhatsApp update sessions

Contacts can update Engine data directly from WhatsApp:
- "update property PROP-1018" → guided field-by-field property editing
- "update contact" → guided field-by-field contact editing
- Supports "cancel" to abort, "all" for full wizard, field-specific commands
- One active session per contact enforced

### Go webhook ingress

A standalone Go service that sits in front of the Node.js application:
- Verifies HMAC-SHA256 signatures with constant-time comparison
- Enqueues verified payloads to Redis and returns HTTP 200 instantly
- Proxies verification challenges to Next.js for DB-backed token matching
- Dockerized multi-stage build (7MB final image)

---

## Deployment

| Service | Where | How |
|---|---|---|
| **Web app** | Vercel, Railway, or any Node.js host | `npm run build && npm start` |
| **Go ingress** | Railway / Docker host | `docker run -p 8080:8080 go-ingress` |
| **Queue worker** | Railway / background container | `npx tsx src/scripts/queue-worker.ts` |
| **Database** | Supabase (managed Postgres) | Run migrations in SQL Editor |
| **Redis** | Upstash / Redis Labs / self-hosted | Set `REDIS_URL` env var |

---

## License

[MIT](./LICENSE). Fork it, brand it, host it.
