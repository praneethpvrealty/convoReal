# Feature Roadmap: Real Estate waCRM

This document outlines the product vision, active milestones, and future development cycles for the Real Estate waCRM platform.

---

## Product Vision
To build the definitive, WhatsApp-first CRM for independent real estate agencies and brokers. The platform combines conversational AI ingestion, smart contact-property matching, automated scheduling, and public showcase sites into a unified, multi-tenant portal.

---

## 🗺️ Product Roadmap

### Milestone 1: Expected Yield Matching & Location-Agnostic Profiling (DONE)
*Provide flexibility for investors who prioritize yields over location coordinates.*
- [x] **Database Expansion**: Add `min_roi` NUMERIC field to `contacts`. (migration 048)
- [x] **UI Preferences**: Create expected min ROI number controls in Contact Forms and Preference Drawers. (`contact-form.tsx`, `contact-detail-view.tsx`)
- [x] **Matching Logic**: Filter properties so `property.roi >= contact.min_roi`. (`src/lib/matching.ts`)
- [x] **Location Agnosticism**: Allow contacts with empty areas or areas containing `'any'` to match properties in any sublocality. (`src/lib/matching.ts`)
- [x] **Scoring Adjustments**: Weight the ROI yield component in matching scoring calculations. (`src/lib/matching.ts`, covered by `matching.test.ts`)

---

### Milestone 2: Interactive Webhook Webflows & Automated Template Management (MOSTLY DONE)
*Reduce chat friction by migrating text conversations into structured WhatsApp buttons and selection flows.*
- [x] **Meta Template Sync**: Auto-fetch approved templates from Meta Graph API to sync text layouts, headers, and media options. (`src/app/api/whatsapp/templates/sync/route.ts`)
- [x] **Interactive Buttons**: Replace textual confirmation steps in chatbot flows with Meta Cloud API Interactive Reply Buttons. (`src/lib/whatsapp/meta-api.ts`, used in `chatbot-engine.ts` and `flows/engine.ts`)
- [ ] **WhatsApp Interactive Flows**: Allow buyers to fill/update their budget and locality preferences directly inside WhatsApp using form screen flows. Note: only the custom menu-tree flow builder (`src/lib/flows/*`) exists today — no native Meta Flows form-screen JSON/encryption endpoint.
- [x] **Outbound Broadcast Queue**: Implement dynamic retries with exponential backoffs for throttled or failed Meta Graph API outbound requests. (`src/lib/broadcasts/sender.ts:357-401`, migration 075)

---

### Milestone 3: AI PDF Brochures & Customer Analytics (Q4 2026)
*Empower agents to generate high-quality marketing collateral on the fly and track customer engagement.*
- [ ] **AI Flyer Customization**: Support custom layout templates for AI-generated flyers (including typography, branding, and color palettes). Partial: `flyer-creator-dialog.tsx` has 3 fixed overlay templates + branding text fields, but no custom typography/color-palette controls.
- [ ] **Brochure Compiler**: Generate downloadable PDF property brochures containing highlights, specs, maps, and agent details. Not started.
- [ ] **Click Tracking**: Encode tracking tokens in shared links (`/showcase/prop-id?c=contact-id`) to notify agents via WhatsApp when a customer opens a listing. Partial: link tokens + open/view events are tracked (`src/lib/pulse/tracker.ts`), but no WhatsApp notification fires on open.
- [ ] **Client Interest Heatmap**: Display match interest scores based on page view durations and images clicked on the showcase portal. Partial: aggregate dwell-time/view-count stats exist (`src/lib/pulse/queries.ts`, `/pulse` page) but no per-contact interest score or true heatmap.

---

### Milestone 4: RERA Registry Integration & Real Estate Portal Sync (Q1 2027)
*Build trust and automate lead generation by integrating external listing platforms and official registries.*
- [ ] **Automated RERA Checker**: Automatically check the `rera_projects` table and official state RERA portals when creating a property listing. Display a "RERA Verified" badge on listings. Note: `rera_projects` is currently populated with AI-generated/mocked data (`src/app/api/projects/sync`), not verified against real state registries — no "RERA Verified" badge field exists yet.
- [ ] **Multi-Portal Sync**: Integrate incoming webhooks or scrapers for listings added to MagicBricks, Housing.com, and 99acres, linking them to agent profiles. Note: only inbound *lead-email* parsing from these portals exists (`src/app/api/leads/email-webhook/*`) — no listing sync.
- [ ] **Duplicate Listing Checker**: Run semantic checks on titles, locations, and images to detect duplicate listings added by different agents.

---

### Milestone 5: Visual Pipelines & Financial Forecasting (Q2 2027)
*Turn matches into closed deals with a visual sales pipeline, commission management, and dashboard reporting.*
- [x] **Visual Kanban Deals Board**: Drag and drop deals across pipeline stages (`Lead`, `Site Visit`, `Negotiation`, `Closed`). (`src/components/pipelines/pipeline-board.tsx`, @dnd-kit)
- [ ] **Brokerage & Commission Splits**: Track expected brokerage commissions, agent splits, and referrer payout splits. Partial: brokerage tracking (percent + amount) is built (migration 040), but agent-split/referrer-payout calculation is not.
- [ ] **Analytics Dashboard**: Graph monthly closed deal values, conversion rates per agent, and top-yielding marketing templates. Partial: `pipeline-analytics.tsx` shows per-pipeline totals only, no per-agent conversion rates or template performance.
- [ ] **Multi-Number Support**: Enable agencies to configure separate WhatsApp numbers for different agents, while maintaining tenant isolation. Blocked: `whatsapp_config` has a `UNIQUE(account_id)` constraint (migration 017); a `multi_number` billing-plan gate exists as a stub but nothing calls it yet.
