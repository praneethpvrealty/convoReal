# Database Schema: Real Estate waCRM

This document provides a comprehensive map of the PostgreSQL schema on Supabase. The application is built on a **multi-tenant architecture** where all operational tables are isolated at the database level by an `account_id` foreign key.

---

## 1. Multi-Tenant Tenancy Model

Every request originating from a team member is scoped to their active `account_id`. Row Level Security (RLS) is enabled on all tables (except utility or public lookup tables), delegating access validation to the custom security function:

```sql
is_account_member(target_account_id UUID, min_role account_role_enum DEFAULT 'viewer') RETURNS BOOLEAN
```

### Member Role Hierarchy:
- `owner` (Value: 4) - Full control, billing, ownership transfer.
- `admin` (Value: 3) - User management, settings manipulation.
- `agent` (Value: 2) - Standard operational data modification (contacts, properties, chats, tasks).
- `viewer` (Value: 1) - Read-only dashboard access.

---

## 2. Table Schemas by Module

### Group A: Tenancy & Profiles

#### 1. `accounts`
Represents an agency/tenant workspace.
- `id` (UUID, PK): Unique identifier.
- `name` (TEXT): Workspace name.
- `owner_user_id` (UUID, FK -> `auth.users`): Reference to the account creator.
- `created_at` / `updated_at` (TIMESTAMPTZ).
- *Unique Index*: `idx_accounts_one_per_owner` (Ensures each user owns at most one account).

#### 2. `profiles`
Extends default Auth users with workspace attributes.
- `user_id` (UUID, PK, FK -> `auth.users`): Reference to core authentication.
- `full_name` (TEXT): Display name.
- `email` (TEXT): Profile email address.
- `avatar_url` (TEXT): Public asset link.
- `account_id` (UUID, FK -> `accounts`): Links the profile to their active tenant workspace.
- `account_role` (account_role_enum): Role within that workspace (`owner`, `admin`, `agent`, `viewer`).

#### 3. `account_invitations`
Pending team member invitations.
- `id` (UUID, PK).
- `account_id` (UUID, FK -> `accounts`).
- `token_hash` (TEXT, UNIQUE): SHA-256 hash of the invite token.
- `role` (account_role_enum): Assigned role.
- `expires_at` / `accepted_at` (TIMESTAMPTZ).

---

### Group B: Contacts Book

#### 4. `contacts`
The CRM address book.
- `id` (UUID, PK).
- `account_id` (UUID, FK -> `accounts`).
- `name` (TEXT): Contact full name.
- `phone` (TEXT): Normalized E.164 phone number.
- `email` (TEXT): Optional email.
- `classification` (TEXT): CHECK constraint `('Owner', 'Seller', 'Buyer', 'Agent', 'Others')` (Default: `'Others'`).
- `status` (TEXT): CHECK constraint `('active', 'pending_review')` (Default: `'active'`).
- `source` (TEXT): Lead source (e.g. `'MagicBricks'`, `'WhatsApp'`).
- `lead_temperature` (TEXT): CHECK constraint `('hot', 'warm', 'cold')`.
- `last_contacted_at` (TIMESTAMPTZ).
- **Preferences (JSON/Arrays)**:
  - `min_budget` / `max_budget` (NUMERIC)
  - `no_budget` (BOOLEAN)
  - `areas_of_interest` (TEXT[]): Target Bengaluru areas.
  - `property_interests` (TEXT[]): Desired specifications (e.g. ROI, old building).
  - `min_roi` (NUMERIC): Minimum yield percentage expected by the buyer.
- `referrer_contact_id` (UUID, FK -> `contacts`): Self-referencing link to track the source contact.

#### 5. `tags` & `contact_tags`
Labels for categorization.
- `tags`: `id`, `name`, `color` (Hex string), `account_id`.
- `contact_tags`: many-to-many lookup table referencing `contact_id` and `tag_id`.

#### 6. `custom_fields` & `contact_custom_values`
User-defined contact attributes.
- `custom_fields`: Defines extra columns dynamically.
- `contact_custom_values`: Stores matching values.

#### 7. `contact_notes`
Timeline log entries.
- `id`, `contact_id`, `author_id` (`profiles.user_id`), `content` (TEXT), `account_id`.

---

### Group C: Properties & Showcases

#### 8. `properties`
Real estate inventory catalog.
- `id` (UUID, PK).
- `property_code` (TEXT, UNIQUE): Human-readable code (e.g., `PROP-1002`).
- `account_id` (UUID, FK -> `accounts`).
- `title` (TEXT) / `description` (TEXT).
- `price` (NUMERIC): List price.
- `location` (TEXT): Full physical address.
- `sublocality` (TEXT) / `city` (TEXT) / `state` (TEXT).
- `project` (TEXT): Project / Building name.
- `bedrooms` / `bathrooms` (NUMERIC).
- `area_sqft` (NUMERIC): Built-up/Land area size.
- `area_unit` (TEXT): e.g. `'Sq.Ft.'`, `'Acre'`.
- `land_area` / `land_area_unit` (For plot/land specs).
- `dimensions` (TEXT): e.g., `30x40`.
- `facing_direction` (TEXT): e.g. `'North'`.
- `nearby_highlights` (TEXT[]): List of nearby landmarks.
- `features` (TEXT[]): Amenities (e.g. Pool, Security).
- `images` (TEXT[]): Array of asset URLs.
- `rental_income` (NUMERIC): Monthly rental income yield.
- `roi` (NUMERIC): Yearly rental yield % (`(rental_income * 12) / price * 100`).
- `floor_tenancies` (JSONB, migration 130): Floor-wise rent roll for pre-leased commercial buildings — array of `{ floor, area_sqft, tenant_name, monthly_rent (excl. GST), lease_start, lease_end, lock_in_months, maintenance, notes }`. CRM-only, never shown on the public showcase. Validation: `src/lib/inventory/floor-tenancies.ts`.
- `listing_source` (TEXT): CHECK constraint `('owner', 'agent')`.
- `owner_contact_id` (UUID, FK -> `contacts`): Link to property owner's contact card.
- `status` (TEXT): e.g. `'Available'`, `'Sold'`, `'Rented'`.
- `is_published` (BOOLEAN): Visible on the public showcase catalog.

#### 9. `showcase_settings`
Public listing portal branding config.
- `id`, `account_id`, `logo_url`, `brand_name`, `theme_color`, `currency` (Default: `'INR'`).

#### 10. `rera_projects`
 Bengaluru authorized construction tracking database.
- `id`, `rera_number` (TEXT, UNIQUE), `project_name`, `developer`, `location`.

---

### Group D: WhatsApp Logs & Integrations

#### 11. `conversations`
Metadata tracking active chat threads.
- `id` (UUID, PK).
- `account_id` (UUID, FK -> `accounts`).
- `contact_phone` (TEXT): Normalized recipient phone.
- `last_message_text` (TEXT) / `last_message_at` (TIMESTAMPTZ).
- `unread_count` (INTEGER).

#### 12. `messages`
Individual message records.
- `id` (UUID, PK).
- `conversation_id` (UUID, FK -> `conversations`).
- `direction` (TEXT): `'inbound'` or `'outbound'`.
- `content_text` (TEXT): Text payload or error reports.
- `media_url` (TEXT): Image / Document links.
- `status` (TEXT): `'sent'`, `'delivered'`, `'read'`, `'failed'`.
- `meta_message_id` (TEXT): Meta Graph API message ID.

#### 13. `message_reactions`
- `id`, `message_id`, `reaction` (TEXT emoji), `agent_id` (`profiles.user_id`).

#### 14. `message_templates`
Approved WhatsApp message templates.
- `id`, `account_id`, `template_name`, `language`, `category`, `status`, `body_text`, `header_type`.

#### 15. `whatsapp_config`
WhatsApp Cloud API access parameters.
- `id`, `account_id`, `phone_number_id`, `waba_id`, `access_token`.
- `flows_private_key` / `flows_public_key` / `flows_key_registered_at`: RSA-2048 keypair for the native Meta Flows encrypted data-exchange endpoint (private key stored AES-256-GCM encrypted). (migration 125)
- *Unique Constraint*: `UNIQUE(account_id)` (One configured number per company).

#### 15b. `whatsapp_meta_flows` (migration 125)
Registry of native Meta WhatsApp Flows (form-screen flows) created per account via the Graph API. Distinct from the in-app chatbot flow builder tables (`flows` / `flow_runs`).
- `id` (UUID, PK), `account_id` (UUID, FK -> `accounts`).
- `flow_key` (TEXT): internal blueprint id, e.g. `'preference_intake'`.
- `meta_flow_id` (TEXT): Meta's flow id.
- `status` (TEXT): `'draft' | 'published' | 'deprecated' | 'error'`.
- `flow_json_version`, `last_synced_at`, `last_error`.
- *Unique Constraint*: `UNIQUE(account_id, flow_key)`.

#### 15c. `whatsapp_meta_flow_sessions` (migration 125)
One row per flow message sent to a contact; maps Meta's opaque `flow_token` back to tenant + contact.
- `id` (UUID, PK), `account_id`, `contact_id` (FKs).
- `flow_key` (TEXT), `flow_token` (TEXT, UNIQUE).
- `status` (TEXT): `'sent' | 'opened' | 'completed' | 'expired' | 'cancelled'`.
- `prefill` (JSONB) / `response` (JSONB), `expires_at`, `completed_at`.

#### 15d. `owner_digest_settings` (migration 126)
Per-account cadence for WhatsApp status digests to property owners.
- `id` (UUID, PK), `account_id` (UUID, FK, UNIQUE).
- `frequency` (TEXT): `'off' | 'daily' | 'weekly'` (weekly = Monday IST).

#### 15e. `owner_digest_log` (migration 126)
Dedup ledger — one row per digest attempted per owner per IST day (insert-as-claim, like `agent_digest_log`).
- `id` (UUID, PK), `account_id`, `owner_contact_id` (FKs).
- `digest_date` (DATE), `period_start` / `period_end` (TIMESTAMPTZ).
- `stats` (JSONB): per-property counters snapshot.
- `channel` (TEXT): `'freeform' | 'template' | 'consent_requested' | 'failed' | 'skipped_no_template'`.
- *Unique Constraint*: `UNIQUE(account_id, owner_contact_id, digest_date)`.
- Related (migration 126): `contacts.owner_digest_consent` (TEXT `'pending' | 'granted' | 'declined'`, set only by the owner's own WhatsApp reply — always overrides the account setting) and `contacts.owner_digest_consent_requested_at` (TIMESTAMPTZ, one-time consent ask).

---

### Group E: Calendar & Checklists

#### 16. `appointments`
Calendar bookings and site viewings.
- `id` (UUID, PK).
- `account_id` (UUID, FK -> `accounts`).
- `title` (TEXT) / `description` (TEXT).
- `start_time` / `end_time` (TIMESTAMPTZ).
- `location` (TEXT).
- `contact_id` (UUID, FK -> `contacts`): Primary client attending (mirrors the first element of `contact_ids`, enforced by the `trg_sync_appointment_contacts` trigger).
- `contact_ids` (UUID[], migration 127): Every contact attached to the event (buyer, partner agent, owner…). GIN-indexed.
- `property_id` (UUID, FK -> `properties`): Listing being viewed.
- `status` (TEXT): CHECK constraint `('scheduled', 'completed', 'cancelled')`.
- `reminder_morning_sent` / `reminder_1h_sent` (BOOLEAN, migration 127): Client WhatsApp reminder flags — morning-of (~7 AM IST) and one-hour-before sends that go to every contact in `contact_ids`. Supersede the older `reminder_24h_sent` / `reminder_2h_sent` flags.
- `agenda` / `minutes` / `outcome` (TEXT, migration 128): Type-specific structured notes — pre-event agenda (meetings, calls, follow-ups, document work; included in the assignee's pre-event brief), post-event minutes (meetings, calls), and post-event outcome (site visits, follow-ups, document work). Per-type visibility config lives in `src/components/calendar/event-types.ts`.

#### 16b. `appointment_reminder_log` (migration 127)
Per-recipient delivery claims for client appointment reminders — one row per `(appointment_id, contact_id, reminder_type)` (UNIQUE). The cron inserts a claim before each WhatsApp send and deletes it if the send fails, so partial failures retry only the missed recipients without duplicating the delivered ones.
- `account_id` / `appointment_id` / `contact_id` (UUID FKs, CASCADE).
- `reminder_type` (TEXT): CHECK `('morning', '1h')`.

#### 17. `todos`
Tasks list with reference linkages.
- `id` (UUID, PK).
- `account_id` (UUID, FK -> `accounts`).
- `title` (TEXT).
- `is_completed` (BOOLEAN).
- `priority` (TEXT): `'low'`, `'medium'`, `'high'`.
- `contact_id` (UUID, FK -> `contacts`).
- `property_id` (UUID, FK -> `properties`).

---

### Group F: Chatbot Draft Sessions

Used by `chatbot-engine.ts` to store half-parsed details from conversations while waiting for user confirmation.

#### 18. `property_draft_sessions`
- `contact_id` (UUID, PK, FK -> `contacts`).
- `draft_data` (JSONB): Contains parsed property JSON.
- `created_at` / `updated_at`.

#### 19. `contact_draft_sessions`
- `contact_id` (UUID, PK, FK -> `contacts`).
- `draft_data` (JSONB): Container parsing multiple bulk contact profiles.

---

### Group G: Deals & Pipelines

#### 20. `pipelines` & `pipeline_stages`
- `pipelines`: `id`, `name`, `account_id`.
- `pipeline_stages`: `id`, `pipeline_id`, `name`, `order_index`.

#### 21. `deals`
CRM sale opportunities.
- `id`, `account_id`, `contact_id`, `stage_id`, `title`, `amount` (NUMERIC), `brokerage_percent` / `brokerage_amount`, `property_id` (UUID, FK -> `properties`).

#### 22. Journey Mind Map (migrations 131 + 138)
Per-(contact × property) funnel tracking behind the `/journey` canvas — records where every shared property/interested contact stands and where the dropped ones fell off.
- `journey_stages`: `id`, `account_id`, `name`, `color`, `position`. Account-level ordered stage list, customisable; app-seeds Shared → Shortlisted → Visited → Owner Meeting → Token & Legal → Registration → Brokerage Paid on first visit.
- `journey_items`: `id`, `account_id`, `contact_id`, `property_id`, `stage_id` (furthest stage reached, FK RESTRICT), `status` (`active`/`dropped`), `source` (`manual`/`whatsapp_share`/`chat_import`/`inquiry_import`, migration 138), `hidden` (true = off-canvas, waits in the Captured tray; WhatsApp share auto-capture arrives hidden), `drop_reason`, `dropped_at`, `planned_stage_id` + `planned_at` (expected next step, migration 142 — ghost node on the map; cleared on any stage move), `notes`, `created_by`. UNIQUE(account_id, contact_id, property_id).
- `journey_events`: append-only history per item — `event_type` (`added`/`advanced`/`moved`/`dropped`/`reactivated`/`hidden`/`unhidden`/`planned`/`plan_cleared`), `from_stage_id`, `to_stage_id`, `reason`, `created_by`.

---

### Group H: Automation & Marketing Flows

- `automations` / `automation_steps`: Trigger conditions and step definitions.
- `automation_logs`: Execution history audits.
- `automation_pending_executions`: Queue for delayed actions.
- `flows` / `flow_nodes` / `flow_runs` / `flow_run_events`: WhatsApp interactive tree flows.

### Group I: Owners Den (migrations 132–133)

The Owners Den is the authenticated portal for property owners — a parallel
identity class to staff. A Den user is an `auth.users` row with **no
`profiles` row**, so every `is_account_member()`-based RLS policy denies
them by construction; their data access happens through `/api/den/*`
(service role + explicit owner scoping via `src/lib/den/auth.ts`).

- `den_users`: One row per Den login. `auth_user_id` (unique, → auth.users),
  verified WhatsApp `phone` + `phone_normalized` (last-10 digits), display
  name and notification preferences (`notify_matches`, `notify_bids`,
  `digest_frequency`). Self-select/update RLS only; inserts are
  service-role.
- `den_contact_links`: Bridge from a Den user to tenant-scoped `contacts`
  rows matched by phone (one per account — the same owner may be managed by
  several agencies). `status` active/revoked; unique `(den_user_id,
  contact_id)`.
- `find_den_owner_contacts(p_phone_last10)`: SECURITY DEFINER lookup used by
  the linking flow — digit-normalized phone match + owner classification
  (or referenced by any `properties.owner_contact_id`).
- `properties.deal_mode` (`off`/`soft`/`aggressive`, + `deal_mode_updated_at`,
  `deal_mode_set_by`): the owner's sell-readiness switch. Partial index
  `idx_properties_deal_pool` backs the cross-tenant matching sweep
  (`deal_mode <> 'off' AND is_published`).
- `handle_new_user()` gains an early-exit guard: signups carrying
  `raw_user_meta_data->>'app_context' = 'den'` skip staff account/profile
  bootstrap entirely.
- `match_events.source` (`internal`/`deal_mode`) + `subject_snapshot`
  (migration 134): Deal Mode properties are matched CROSS-TENANT against
  other accounts' Buyer/Agent contacts by the sweep
  (`/api/cron/deal-mode-matching`); the resulting event lives in the
  buyer's account and carries a MASKED property snapshot
  (`src/lib/den/masking.ts`) — the buyer cannot join the foreign property
  row through RLS.
- `den_match_unlocks` (migration 134): the paid reveal. One row per
  (buyer account, property), UNIQUE-constrained against double billing;
  `credits_burned` via the standard wallet (`burn_credits_tx`, feature
  `match_unlock`). Member SELECT via `is_account_member`; writes
  service-role only (`/api/match-unlocks`).
- `property_bids` + `property_bid_events` (migration 135): FREE offers
  after unlock (`unlock_id` NOT NULL is the entry ticket). Lifecycle
  pending → accepted/rejected/countered/withdrawn/expired, all via
  atomic conditional updates in service-role routes; contact details
  are mutually revealed only on accept. SELECT for both the bidder and
  the owning agency (`is_account_member` on either account); the Den
  owner reads through `/api/den/bids`. `properties.min_bid` is the
  owner's optional offer floor. Expiry cron `/api/cron/den-bids-expiry`
  (deadline + 48h deal-mode-off grace).
- `deal_rooms` + `token_escrows` (migration 136): a room opens per
  ACCEPTED bid (unique bid_id) — meeting scheduling plus optional
  **Token Safe** for the post-meeting token payment (bayana). Token
  money is real ₹ (minor units), never credits, and the platform never
  holds funds: providers are record-keeping today (`manual_escrow`,
  `direct` receipt) with licensed partners (Escrowpay/Castler) plugging
  in via the adapter in `src/lib/den/token-safe.ts` and the
  signature-verified webhook `/api/webhooks/token-safe`. Escrow
  lifecycle proposed → accepted → funded → released/refunded/disputed
  (release requires BOTH parties' confirmation); one active escrow per
  room via partial unique index. SELECT for both party accounts; writes
  service-role only.
- **Verified WhatsApp phone hard-wiring** (migration 137): source of
  truth is `auth.users.phone` + `phone_confirmed_at` (set only by
  WhatsApp OTP). `sync_verified_phone_to_profile` trigger mirrors the
  verified number onto `profiles.phone`; `profiles_phone_guard`
  rejects any client-side phone write ("phone can only be changed
  through WhatsApp OTP verification"). The dashboard shell gates on
  `phone_confirmed_at` (once per account — Google re-logins are never
  re-asked) via `/verify-phone`.

---

## 3. Database Indexes Strategy

To guarantee rapid loading times, the schema includes target indices:
1. **Tenancy Indexing**: `idx_[table]_account` on `account_id` across all parent tables.
2. **Search Indexing**:
   - `idx_contacts_status` on `contacts(status)`
   - `idx_contacts_phone` on `contacts(phone)`
   - `idx_todos_contact` / `idx_todos_property` on `todos`
   - `idx_properties_owner_contact` on `properties(owner_contact_id)`
3. **Draft Indexing**: `idx_one_active_run_per_contact` on `flow_runs(account_id, contact_id) WHERE status = 'active'`.
