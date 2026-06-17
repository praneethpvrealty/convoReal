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

The master database schema is consolidated inside [RUN_IN_SUPABASE_SQL_EDITOR.sql](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/supabase/RUN_IN_SUPABASE_SQL_EDITOR.sql). Key tables:

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

---

## 7. Pending Tasks

### Task 1: ROI Yield Matching & Contact Expected ROI Preference
**Goal**: Allow buyers to filter and match properties purely based on minimum ROI/Yield requirements (e.g. ROI > 4%), and prioritize yield over specific locations if requested.

**Execution Steps**:
1. **Database Migration**:
   - Create a migration file `048_add_contacts_min_roi.sql`.
   - Add a `min_roi` column of type `NUMERIC` to the `contacts` table.
   - Append this script to the end of `supabase/RUN_IN_SUPABASE_SQL_EDITOR.sql`.
2. **TypeScript Types**:
   - Update the `Contact` interface in `src/types/index.ts` to include `min_roi?: number | null;`.
3. **Contact Forms & Detail Drawer**:
   - In `contact-form.tsx` (real estate preferences section), add a number input field for "Expected Min ROI (%)".
   - In `contact-detail-view.tsx` (Preferences tab), display and allow editing of "Expected Min ROI (%)".
4. **Matching Engine (`src/lib/matching.ts`)**:
   - Update `getMatchingContacts` to factor in the `min_roi` criteria:
     - If the contact has `min_roi` defined (e.g. `4`):
       - It is a match only if the property has `roi` set and `property.roi >= contact.min_roi`.
       - If the contact does not have a `min_roi` set, matching defaults to true for that criteria.
     - **Location-Agnostic Option**: If a contact has `areas_of_interest` containing `'any'` or left blank, the location filter should match any property. Make sure matching scores prioritize the ROI match components.
5. **Types and Test Verification**:
   - Run type checks (`npm run typecheck`) and the test suite (`npm test`).

---

## 8. Coding Standards & Conventions

1. **Strict Type Safety**: All queries, state variables, and API payloads must be strongly typed using interface definitions in `src/types/index.ts`.
2. **Next.js App Router rules**:
   - Keep page files (`page.tsx`) lightweight. Put interactive forms and modals inside components (e.g., `src/components/`).
   - Use `'use client'` strictly for client components.
3. **Tailwind Styling**: Use Tailwind CSS for UI layouts. Maintain the dark glassmorphic/sleek aesthetics (rich blues, slate backdrops, harmony colors for badges).
4. **Supabase Tenancy Scoping**: Every database select, insert, or update query on tenant tables **must** be scoped to `account_id` or check user access rights (always verify RLS compatibility).
5. **No Placeholders**: Never use mock data blocks. If images are required, use media URLs or upload helpers.
