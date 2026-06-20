# Codebase Refactoring & De-bloating Audit

To ensure the codebase remains clean, maintainable, and type-safe before we make major architectural scaling modifications, this audit highlights duplicated codes, services, utility functions, and architectural bottlenecks, along with proposed refactoring candidates.

---

## 1. Major Duplications (Action Required)

### A. WhatsApp Send & DB Persistence Logic
* **Where it is duplicated**:
  1. [`src/app/api/whatsapp/send/route.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/app/api/whatsapp/send/route.ts) (User-initiated manually sent texts/templates)
  2. [`src/app/api/whatsapp/broadcast/route.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/app/api/whatsapp/broadcast/route.ts) (Bulk template broadcasts)
  3. [`src/lib/automations/meta-send.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/lib/automations/meta-send.ts) (Automation engine sending text/templates)
  4. [`src/lib/flows/meta-send.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/lib/flows/meta-send.ts) (Interactive buttons, lists, and media sends)
  5. [`src/lib/appointments/reminder.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/lib/appointments/reminder.ts) (Visit reminder crons)
* **What is duplicated**:
  - Fetching/resolving account-level `whatsapp_config` + token decryption.
  - Generating and checking `phoneVariants(sanitizedPhone)` (to dynamically handle prefix mismatches, country codes, and trunk 0s).
  - Executing retry attempts inside a catch block that isolates `isRecipientNotAllowedError`.
  - Auto-updating the `contacts` record with the corrected phone number variant when a variant succeeds.
  - Logging the outgoing message in the `messages` table and updating `conversations.last_message_text`, `last_message_at`, and `updated_at`.
* **Proposed Action**:
  - Extract a unified helper `sendWhatsAppMessageAndPersist(...)` in a central module like [`src/lib/whatsapp/meta-api-dispatcher.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/lib/whatsapp/meta-api-dispatcher.ts).
  - Reduce the codebase by approximately **400+ lines** of duplicated wrapper logic.

### B. Currency & Value Formatting
* **Where it is duplicated**:
  1. [`src/components/pipelines/pipeline-board.tsx`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/components/pipelines/pipeline-board.tsx)
  2. [`src/components/pipelines/pipeline-analytics.tsx`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/components/pipelines/pipeline-analytics.tsx)
  3. [`src/components/pipelines/deal-card.tsx`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/components/pipelines/deal-card.tsx)
  4. [`src/components/dashboard/pipeline-donut.tsx`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/components/dashboard/pipeline-donut.tsx)
  5. [`src/app/(dashboard)/dashboard/page.tsx`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/app/(dashboard)/dashboard/page.tsx)
* **What is duplicated**:
  - `formatCurrency(value, currency)` and `formatCurrencyShort(value, currency)`.
* **Proposed Action**:
  - Extract these formatting helpers into the existing utility file [`src/lib/currency-utils.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/lib/currency-utils.ts) (which currently only handles icon rendering) and import them directly.

---

## 2. High-Complexity / Code Bloat Concerns

### A. The Monolithic Webhook Route (`webhook/route.ts`)
* **File location**: [`src/app/api/whatsapp/webhook/route.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/app/api/whatsapp/webhook/route.ts)
* **Complexity**: **1,335 lines** of code in a single file.
* **The Smell**:
  - Handles everything from token verification, webhook routing, status receipt handling, raw text/media/location parsing, vCard imports, appointment text parsing, chatbot triggers, to interactive reply captures.
* **Proposed Action**:
  - Break this endpoint down into sub-handlers (e.g. `src/lib/whatsapp/webhook/handlers/status-handler.ts`, `message-handler.ts`, and `vcard-parser.ts` helper).
  - This prepares the codebase for Phase 3 of the Scaling Blueprint where the webhook ingress receiver is moved to Go. If the router is already modularized, translating it becomes a trivial exercise.

### B. Chatbot Engine SQL Queries (`chatbot-engine.ts`)
* **File location**: [`src/lib/ai/chatbot-engine.ts`](file:///Volumes/work/CRM%20project/waCrmCustomised/wacrm/src/lib/ai/chatbot-engine.ts)
* **Complexity**: **1,300+ lines** containing 40+ raw `.from()` Supabase calls.
* **The Smell**:
  - Database queries, Gemini parsing parameters, fallback messages, and draft state transitions are intermingled, making testing difficult.
* **Proposed Action**:
  - Move state operations into repository functions like `getActiveDraftSession`, `createDraftSession`, and `commitDraftToProperties`.
  - Keep `chatbot-engine.ts` purely focused on prompt compiling, state decision tree logic, and AI response mapping.

---

## 3. Recommended Refactoring Plan

We recommend executing a quick clean-up phase before embarking on the scaling changes:

1. **Phase A (Immediate - Easy Wins)**: Extract `formatCurrency` to `src/lib/currency-utils.ts` and refactor the component imports.
2. **Phase B (Immediate - High Value)**: Create `meta-api-dispatcher.ts` and refactor manual sends, automations, reminders, and flows to use the unified helper. This will consolidate Meta-specific behaviors, reducing bugs related to variant checks.
3. **Phase C (Preparatory)**: Break up `webhook/route.ts` into isolated handler modules under a `webhook/handlers/` folder to clean up the webhook endpoint.
