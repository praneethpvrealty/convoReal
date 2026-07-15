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
- `channel` (TEXT): `'freeform' | 'template' | 'failed' | 'skipped_no_template'`.
- *Unique Constraint*: `UNIQUE(account_id, owner_contact_id, digest_date)`.
- Related: `contacts.owner_digest_opt_out` (BOOLEAN, migration 126) — owner paused digests via WhatsApp reply.

---

### Group E: Calendar & Checklists

#### 16. `appointments`
Calendar bookings and site viewings.
- `id` (UUID, PK).
- `account_id` (UUID, FK -> `accounts`).
- `title` (TEXT) / `description` (TEXT).
- `start_time` / `end_time` (TIMESTAMPTZ).
- `location` (TEXT).
- `contact_id` (UUID, FK -> `contacts`): Client attending.
- `property_id` (UUID, FK -> `properties`): Listing being viewed.
- `status` (TEXT): CHECK constraint `('scheduled', 'completed', 'cancelled')`.

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

---

### Group H: Automation & Marketing Flows

- `automations` / `automation_steps`: Trigger conditions and step definitions.
- `automation_logs`: Execution history audits.
- `automation_pending_executions`: Queue for delayed actions.
- `flows` / `flow_nodes` / `flow_runs` / `flow_run_events`: WhatsApp interactive tree flows.

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
