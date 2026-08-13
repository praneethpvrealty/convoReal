# Feature Roadmap: Real Estate ConvoReal

This document outlines the product vision, active milestones, and future development cycles for the Real Estate ConvoReal platform.

---

## Product Vision
To build the definitive, WhatsApp-first Engine for independent real estate agencies and brokers. The platform combines conversational AI ingestion, smart contact-property matching, automated scheduling, and public showcase sites into a unified, multi-tenant portal.

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

### Milestone 2: Interactive Webhook Webflows & Automated Template Management (DONE)
*Reduce chat friction by migrating text conversations into structured WhatsApp buttons and selection flows.*
- [x] **Meta Template Sync**: Auto-fetch approved templates from Meta Graph API to sync text layouts, headers, and media options. (`src/app/api/whatsapp/templates/sync/route.ts`)
- [x] **Interactive Buttons**: Replace textual confirmation steps in chatbot flows with Meta Cloud API Interactive Reply Buttons. (`src/lib/whatsapp/meta-api.ts`, used in `chatbot-engine.ts` and `flows/engine.ts`)
- [x] **WhatsApp Interactive Flows**: Buyers fill/update their budget and locality preferences directly inside WhatsApp using native Meta form-screen flows. Endpoint-backed: Flow JSON blueprint + prefill/response mapping (`src/lib/whatsapp/preference-flow.ts`), encrypted data-exchange endpoint with RSA-OAEP/AES-GCM handshake (`src/app/api/whatsapp/flows/endpoint/[accountId]/route.ts`, `src/lib/whatsapp/flow-crypto.ts`), Meta lifecycle (create/upload/publish + key registration) in `src/lib/whatsapp/meta-flow-service.ts`, `nfm_reply` webhook handling + "update my preferences" trigger in `webhook-handler.ts`. (migration 125)
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

---

### Milestone 6: Public API & MCP Access (Q3 2027)
*Let a workspace be reached from outside the app — by an AI client, an automation platform, or a partner script.*
- [x] **Per-Account API Keys**: Long-lived, revocable, scoped (`read` / `write`) credentials for non-browser clients. Only the SHA-256 hash is stored; the plaintext is shown once. (migration 256, `src/lib/auth/api-keys.ts`, `src/app/api/account/api-keys/`)
- [x] **Versioned `/api/v1` Surface**: Fifteen account-scoped endpoints over inventory, contacts, matching, Match Radar, deals, agenda, notes, to-dos and the Portfolio rollups. Service-role client under explicit `account_id` scoping, the same posture as the Den and buyer portals. (`src/app/api/v1/`, `src/lib/v1/`)
- [x] **MCP Server**: Standalone stdio server exposing 16 tools to MCP clients such as Claude Desktop, including both directions of the matching engine. (`mcp/`)
- [x] **Portfolio Rollups**: Agency-side view of the owner and buyer portals — how much owner stock is still sellable and what it is worth, buyer budget distribution (average, median, range), bid and shortlist activity. SQL aggregates scoped through the account's own `den_contact_links` / `buyer_contact_links`, so a portal identity the account has not linked is unreachable. (migration 257, `src/lib/v1/portfolio.ts`, `src/app/api/v1/portfolio/`)
- [x] **API Keys Settings UI (web)**: Create, list and revoke keys from Settings → API Keys. Admin+ and Agency-plan gated, matching the server. The secret is shown once, read-only is the default, and revoked keys stay listed so the record survives. (`src/components/settings/api-keys-tab.tsx`)
- [ ] **API Keys Settings UI (mobile)**: Not built — a §2.8 gap, stated rather than silent. The mobile app has no account-administration surface at all today (no Members, Teams, Billing or Routing), so API keys would be the first of its kind and needs a Settings shell to live in rather than a one-off screen. Deferred with the rest of that surface.
- [ ] **Hosted Remote MCP**: OAuth 2.1 with dynamic client registration at `/api/mcp`, so a workspace can be connected without running a local process. Deliberately deferred until the stdio server shows real usage.
- [ ] **Rate Limiting Across Instances**: `RATE_LIMITS.apiKeyV1` is enforced by the in-process limiter in `src/lib/rate-limit.ts`, which holds its Map in one Node process. Horizontal scale silently defeats it — swap for Redis before this surface is promoted beyond design partners.

---

### Deferred: account administration on mobile
*§2.8 gaps, stated rather than silent. They share one root cause: the mobile app has no account-administration surface at all (no Members, Teams, Billing, Routing or Settings shell), so each of these would be the first of its kind rather than a screen added to an existing section.*
- [ ] **Owner details request wording (mobile)**: The per-account editor for the seller intake message ships on web only (Settings → WhatsApp → Owners). The *message itself* is at full parity — the mobile sheet reads the same saved wording through `GET /api/owners/details-request/settings` and sends through the same route — so an account that customises it on web sees the change on the phone immediately. Only the editing UI is missing. (migration 262, `src/components/settings/owner-details-request-card.tsx`)
- [ ] **API Keys Settings UI (mobile)**: See Milestone 6. Same root cause, same deferral.

---

### Deferred: portal posting on mobile
*A §2.8 gap, stated rather than silent.*
- [ ] **Portal ad ids on mobile** (`src/components/inventory/portal-post-dialog.tsx`, the `99 / MB / H` badges in `src/components/inventory/property-list.tsx`): recording where a listing is advertised, and the portal's own ad id for it, ships on web only. Mobile has no portal surface at all — posting is a copy-paste flow into the portals' own web forms, assisted by the Chrome extension, so the dialog grew where the work happens. What *is* at parity is the part that matters for lead accuracy: the unmapped-ads queue and the one-tap assertion from a lead both run on the phone (`mobile/components/unmapped-portal-ads.tsx`), reading the same `unmapped_portal_ads` and `POST /api/contacts/[id]/portal-link`. So an agent can map every ad from mobile; they just cannot see or edit the ad id from the listing itself. Closing it means a read-only portal section on the mobile property screen, plus the ad-id editor.
