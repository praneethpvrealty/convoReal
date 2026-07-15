# Project Handover Document: Real Estate waCRM

This document serves as a comprehensive project overview and state capture. If you are a new AI agent resuming work, read this document first to understand the project architecture, tech stack, database schema, folder layout, progress, and next steps.

---

## 1. Safely Switching Models

If you are switching the model (e.g. to **Claude Opus 4.6** or another LLM), you will **not** lose the progress on the codebase because all files, migrations, and local tests are committed and pushed to the remote repository. 

To ensure the new model has full context:
1. **Read this file** (`PROJECT_HANDOVER.md`) at the very start of the conversation.
2. **Read CLAUDE.md and AGENTS.md** in the root directory.
3. **Verify the database state** against `supabase/RUN_IN_SUPABASE_SQL_EDITOR.sql`.

---

## 2. Tech Stack & Architecture

- **Core**: Next.js 15 (App Router, React 19, TypeScript)
- **Styling**: Tailwind CSS & Shadcn UI (Lucide React Icons)
- **Database**: Supabase (PostgreSQL, Realtime, row-level security (RLS), custom triggers, and functions)
- **AI Integrations**: 
  - **Gemini API** (`gemini-2.5-flash` primary, with automatic failover to `gemini-1.5-flash` for description generation). Used for description copywriting, chatbot message classification, and multi-contact parsing.
  - **Hugging Face / OpenAI / Google** options for AI Flyer generation.
- **WhatsApp Integration**: Meta WhatsApp Cloud API (Graph API) for webhook status callbacks, interactive templates, and button messages.
- **Testing**: Vitest (all 379 tests passing successfully).

---

## 3. Database Schema

The master database schema is consolidated inside [RUN_IN_SUPABASE_SQL_EDITOR.sql](./supabase/RUN_IN_SUPABASE_SQL_EDITOR.sql). Key tables:

1. **`accounts`**: Enterprise/agency accounts. Scopes all multi-tenant tables.
2. **`contacts`**: Contacts book.
   - `classification`: ENUM ('Owner', 'Seller', 'Buyer', 'Agent', 'Others').
   - `status`: ENUM ('active', 'pending_review').
   - Preferences: `min_budget`, `max_budget`, `no_budget`, `areas_of_interest` (TEXT[]), `property_interests` (TEXT[]).
3. **`properties`**: Real estate inventory.
   - Core details: `title`, `description`, `price`, `location` (full address), `sublocality`, `city`, `state`, `project`, `status`, `is_published` (visible on public portal).
   - Real estate specs: `bedrooms`, `bathrooms`, `area_sqft`, `area_unit`, `land_area`, `land_area_unit`, `dimensions`, `facing_direction`, `nearby_highlights` (TEXT[]), `features` (TEXT[]), `images` (TEXT[]).
   - Financials: `rental_income` (monthly), `roi` (calculated yield %).
   - **`listing_source`**: `'owner'` (Direct from Owner) or `'agent'` (Referred by Agent).
   - `owner_contact_id`: References the contact record who owns the property.
4. **`property_draft_sessions`**: Active chatbot property draft session per contact.
5. **`contact_draft_sessions`**: Active chatbot contact draft session per contact.
6. **`appointments`**: Site visits and calendar bookings.
7. **`todos`**: Checklist tasks (stores references to `contact_id` and `property_id` when parsed using `@` or `#`).
8. **`message_templates`**: Approved WhatsApp template mappings.

---

## 4. Folder Structure

```
wacrm/
├── src/
│   ├── app/                         # Next.js App Router pages & API routes
│   │   ├── (auth)/                  # Login, registration, invitations
│   │   ├── (dashboard)/             # Main operational portal
│   │   │   ├── calendar/            # Site visits calendar & To-Do checklists
│   │   │   ├── contacts/            # Lead list, profile details, preferences
│   │   │   ├── inventory/           # Real estate property inventory lists
│   │   │   └── inbox/               # Chat window & inbox threads
│   │   ├── api/                     # Next.js backend API routes
│   │   │   ├── leads/               # MagicBricks, Housing, 99acres email webhooks
│   │   │   ├── properties/          # CRUD listings
│   │   │   └── whatsapp/            # Meta webhook status updates and webhooks
│   ├── components/                  # Shared React UI components
│   │   ├── contacts/                # Device import form & preferences editors
│   │   ├── inventory/               # Property forms, card layouts, share wizards
│   │   └── layout/                  # Sidebar navigation
│   ├── hooks/                       # Custom hooks (auth, roles, triggers)
│   ├── lib/                         # Core utility & engine files
│   │   ├── ai/                      # chatbot-engine.ts & gemini.ts
│   │   ├── appointments/            # Automated reminder delivery logic
│   │   ├── data/                    # Bengaluru localities banks
│   │   ├── matching.ts              # Real estate contact-property matching logic
│   │   └── whatsapp/                # Meta API client, phone utils, templates
│   └── types/                       # Shared TypeScript definitions
└── supabase/
    ├── migrations/                  # Incremental database migrations
    └── RUN_IN_SUPABASE_SQL_EDITOR.sql # Master DB seed & schema configuration
```

---

## 5. APIs Integrated

1. **`POST /api/whatsapp/broadcast`**: Outbound broadcast campaign sender matching parameters and saving sent records inside `messages`.
2. **`POST /api/whatsapp/webhook`**: Inbound webhook processing:
   - Identifies billing/delivery errors from Meta and appends them inline in the chat inbox.
   - Captures client schedule questions (e.g. "my schedule") and replies with dynamic visit details.
   - Integrates vCards and messages with `chatbot-engine.ts` for property and contact ingestion.
3. **`POST /api/leads/email-webhook`**: Inbound portal email lead parsing (MagicBricks, Housing, 99acres) into contact drafts.
4. **`POST /api/ai/generate-description`**: Gemini desc generator with automatic quota failovers.
5. **`GET /api/properties` & `GET /api/contacts`**: collections list with pagination and scoping.
6. **`GET/POST/PUT/DELETE /api/todos` & `/api/appointments`**: Site visit calendar actions.

---

## 6. Current Progress (Recently Completed)

1. **Automated Contact Ingestion Chatbot**:
   - Classifies if a message contains contact details.
   - Parses lists of contact drafts from text, vCards, or screenshots.
   - Confirms contact drafts using **WhatsApp Interactive Reply Buttons** (Confirm & Cancel).
2. **Multi-Contact Parsing**:
   - Expanded Gemini parsing prompts to extract multiple contacts (such as screenshots containing multiple leads) in an array.
   - Re-engineered the validation, preview renderer, and duplicate-checking routine in `chatbot-engine.ts` to filter existing contacts and save new ones in bulk.
3. **Punctuation-Agnostic Matching (Period Normalization)**:
   - Normalized matching logic in `src/lib/matching.ts` to ignore period punctuation (e.g. J.P. Nagar vs JP Nagar) so layout matches resolve perfectly.
4. **Property Listing Source**:
   - Added `listing_source` ('owner' vs 'agent') to properties.
   - Displays a styled **Agent Referred** badge on agent listings.
   - Added a "Listing Source" filter select (All, Direct (Owner), Referred by Agent) to the inventory page toolbar.
5. **ROI Yield Matching (Migration 048)**:
   - Added Expected Min ROI preferences (`min_roi` column) to the `contacts` table, preferences drawer, and contact forms.
   - Updated the property-contact matching engine (`src/lib/matching.ts`) to enforce ROI matching thresholds (e.g. `property.roi >= contact.min_roi`).
6. **Approved Template Webhook Auto-Replies (Migration 061)**:
   - Added support for sending approved WhatsApp templates (e.g. Utility category `lead_welcome_utility`) as auto-replies to incoming email webhook leads.
   - Handled dynamic parameter bindings: `{{1}}` for lead name, `{{2}}` for portal source.
   - Integrated dynamic URL button mapping matching `?ref=ACCOUNT_ID` to route users back to the tenant's public showcase page.
   - Added template auto-reply dropdown selectors and rich visual preview cards in Settings (`other-settings.tsx`).
7. **Forwarding Verification Link Parser**:
   - Expanded verification link extraction regex inside `route.ts` to capture Google forwarding confirmations from `mail-settings.google.com` (which personal Gmail accounts use).
8. **Native WhatsApp Flows — Buyer Preference Intake (Migration 125)**:
   - Endpoint-backed Meta Flow (form screens inside WhatsApp) letting buyers fill/update budget, localities, property types, and expected min ROI.
   - Flow JSON blueprint, prefill and response mapping in `src/lib/whatsapp/preference-flow.ts`; Meta Flows crypto handshake (RSA-OAEP SHA-256 + AES-GCM with flipped-IV responses) in `src/lib/whatsapp/flow-crypto.ts`.
   - Per-tenant encrypted data-exchange endpoint at `/api/whatsapp/flows/endpoint/[accountId]` (ping health checks, INIT prefill, data_exchange save, Meta error codes 421/427/432).
   - Lifecycle service `src/lib/whatsapp/meta-flow-service.ts`: keypair generation + registration (`/{phone_number_id}/whatsapp_business_encryption`), flow create/asset upload/publish on Meta, one-live-session-per-contact flow tokens (`whatsapp_meta_flow_sessions`), idempotent response application.
   - Triggers: buyer texts "update my preferences" (or `update_preferences` button) → `webhook-handler.ts` sends the flow; agents can send via `POST /api/whatsapp/flows/send`; setup/publish via `POST /api/whatsapp/flows/setup` or the "WhatsApp Flows" card in Settings → WhatsApp (`src/components/settings/whatsapp-flows-card.tsx`). Completed forms arrive as `interactive.nfm_reply` webhooks → contact updated + chat confirmation.
9. **Owner Property Status Digests (Migration 126)**:
   - Daily/weekly WhatsApp digests to property owners (`properties.owner_contact_id`) summarizing buyer activity per listing: new enquiries (`contact_property_inquiries`), shortlisted buyers (new `deals`), scheduled site visits (`appointments` `event_type='site_visit'`), showcase views (`showcase_events`). Sent only when a period has activity.
   - Engine in `src/lib/owners/owner-digest.ts` (pure helpers unit-tested); cron `/api/cron/owner-digest` (vercel.json, 10:00 IST) with insert-as-claim dedup in `owner_digest_log`.
   - Template-first delivery (`owner_property_digest` Utility template, `src/lib/whatsapp/owner-digest-template.ts`) with free-form upgrade when the 24h window is open.
   - Owner control via WhatsApp replies "STOP UPDATES"/"START UPDATES" (webhook-handler → `contacts.owner_digest_opt_out`); account cadence via Settings → WhatsApp "Owner Property Digest" card (`owner-digest-card.tsx`, `owner_digest_settings` table).
10. **Chatbot Concurrent Image-Upload Debounce**:
   - Implemented `sendPropertyDraftPreviewDebounced` in `chatbot-engine.ts`.
   - Pauses confirmation preview dispatches for 4 seconds, compares update timestamps in `property_draft_sessions`, and ensures only the last concurrent thread triggers a single compiled preview draft card (preventing duplicate or intermediate replies during concurrent multi-photo/document uploads).

---

## 7. Pending Tasks

*(Currently, all major milestones from the immediate roadmap have been successfully implemented and verified with clean TypeScript and ESLint type checks. Any subsequent features or enhancements will be appended here as requested.)*

---

## 8. Coding Standards & Conventions

1. **Strict Type Safety**: All queries, state variables, and API payloads must be strongly typed using interface definitions in `src/types/index.ts`.
2. **Next.js App Router rules**:
   - Keep page files (`page.tsx`) lightweight. Put interactive forms and modals inside components (e.g., `src/components/`).
   - Use `'use client'` strictly for client components.
3. **Tailwind Styling**: Use Tailwind CSS for UI layouts. Maintain the dark glassmorphic/sleek aesthetics (rich blues, slate backdrops, harmony colors for badges).
4. **Supabase Tenancy Scoping**: Every database select, insert, or update query on tenant tables **must** be scoped to `account_id` or check user access rights (always verify RLS compatibility).
5. **No Placeholders**: Never use mock data blocks. If images are required, use media URLs or upload helpers.
