import type { AccountRole, OrgRole } from "@/lib/auth/roles";

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  /**
   * Legacy free-form role column from migration 001. Never read
   * by the app since 017_account_sharing.sql introduced the typed
   * `account_role` enum. Flagged for removal in a later cleanup
   * migration — kept on the type so existing destructures don't
   * break.
   */
  role: string;
  /**
   * Opted-in beta feature keys for this account. The column survives
   * for future beta gates; no current feature reads it (Flows was
   * the last user and went to soft-GA in PR #134). Defaults to `[]`
   * for every profile; toggled per-account via a direct UPDATE on
   * the `profiles` row.
   */
  beta_features?: string[];
  /**
   * Account this profile is a member of. Added by
   * `017_account_sharing.sql`; NOT NULL in the DB post-backfill.
   * Optional on the type only because older serialised payloads
   * (cached client state, test fixtures) may not have it yet.
   */
  account_id?: string;
  /**
   * Caller's role within their account. Source of truth for every
   * role-gated UI / API check — call `hasMinRole` from
   * `@/lib/auth/roles` rather than comparing this string directly.
   */
  account_role?: AccountRole;
  /**
   * Org-hierarchy role (migration 082_org_hierarchy.sql) — source of
   * truth going forward. `account_role` above is kept in sync by a DB
   * trigger for as-yet-unmigrated readers, but new code should prefer
   * this field and `hasMinOrgRole` from `@/lib/auth/roles`.
   */
  org_role?: OrgRole;
  /** Team this profile belongs to. Null for Org Managers and for any
   *  account still in Solo Mode (no teams created yet). */
  team_id?: string | null;
  /** Former 'viewer' role folds into org_agent + this flag. */
  is_read_only?: boolean;
  /** Locality keywords this agent covers, for routing rule 3. */
  coverage_areas?: string[] | null;
  /** Toggled by the agent themselves or their leader — used by the
   *  routing engine's round-robin rule to skip unavailable agents. */
  is_available?: boolean;
  created_at: string;
}

// ============================================================
// Account-sharing entities (017_account_sharing.sql)
// ============================================================

export interface Account {
  id: string;
  name: string;
  /** auth.users.id of the immutable owner. */
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

/**
 * Hydrated member row for the Settings → Members tab. Combines
 * the profile and its account_role for a single member of the
 * caller's account. Sensitive fields (email) are populated only
 * when the caller has admin+ — agents and viewers see name +
 * avatar + role only.
 */
export interface AccountMember {
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  role: AccountRole;
  joined_at: string;
  /** Org-hierarchy role (migration 082) — source of truth going forward. */
  org_role?: OrgRole;
  team_id?: string | null;
}

/**
 * Outstanding invite link row. `token_hash` is intentionally
 * absent — it lives only in the DB and on the server. The
 * plaintext token is returned once at creation time and surfaced
 * via the invite URL; never re-emitted.
 */
export interface AccountInvitation {
  id: string;
  account_id: string;
  /** Roles offered via invite — owner is never offered. */
  role: Exclude<AccountRole, "owner">;
  created_by_user_id: string | null;
  label: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
}

/** Coordinates for one area of interest, resolved via Google Places
 *  (migration 126). `name` matches the entry in areas_of_interest. */
export interface AreaOfInterestGeo {
  name: string;
  lat: number;
  lng: number;
}

export interface Contact {
  id: string;
  user_id: string;
  phone: string;
  secondary_phones?: string[];
  name?: string;
  /** Name Tag — short internal qualifier shown after the name in the CRM
   *  (e.g. "Bank DSA"). Never included in outbound messages, which use
   *  `name` only (migration 122). */
  name_tag?: string | null;
  email?: string;
  company?: string;
  classification?: 'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Developer' | 'Owner & Buyer' | 'Others';
  avatar_url?: string;
  min_budget?: number;
  max_budget?: number;
  no_budget?: boolean;
  areas_of_interest?: string[];
  /** Coordinates for Google-picked areas_of_interest entries (migration 126);
   *  proximity matching falls back to the static locality table otherwise. */
  areas_of_interest_geo?: AreaOfInterestGeo[] | null;
  property_interests?: string[];
  status?: 'active' | 'pending_review';
  lead_temp?: 'HOT' | 'COLD' | 'Not Responding' | 'Dead' | null;
  dob?: string | null;
  feedback_status?: 'not_requested' | 'requested' | 'collected';
  last_contacted_at?: string | null;
  strict_area_match?: boolean;
  referrer?: string;
  referrer_contact_id?: string | null;
  requirements?: string | null;
  min_roi?: number | null;
  /** AI-extracted structured preferences (migration 092) — populated by
   *  /api/contacts/extract-preferences from requirements + notes text.
   *  Explicit fields above always win; these fill the gaps. */
  pref_property_types?: string[] | null;
  pref_property_categories?: string[] | null;
  pref_bhk_min?: number | null;
  pref_bhk_max?: number | null;
  pref_budget_min?: number | null;
  pref_budget_max?: number | null;
  pref_areas?: string[] | null;
  pref_excluded_areas?: string[] | null;
  /** AI-extracted named projects/societies the buyer wants (migration 156),
   *  distinct from pref_areas localities. A property whose project/title
   *  matches one is a strong, decisive signal in src/lib/matching.ts. */
  pref_projects?: string[] | null;
  pref_min_roi?: number | null;
  /** AI-suggested CRM tag labels (migration 150) — display-only until
   *  an agent confirms one, which creates/attaches a real tag. */
  pref_suggested_tags?: string[] | null;
  /** AI-extracted / inferred listing intent(s): 'Sale' | 'Rent' | 'JV/JD' |
   *  'Built to Suit' (migration 117). Gates JV/BTS properties out of
   *  matching for contacts who haven't stated that intent. */
  pref_listing_types?: string[] | null;
  pref_source_hash?: string | null;
  pref_extracted_at?: string | null;
  contact_notes?: { note_text: string }[] | null;
  last_inquired_property_id?: string | null;
  source?: string | null;
  /** Org hierarchy (migration 082) — which agent/team this contact is
   *  scoped to. Null = unassigned (visible to Org Manager/Leader via the
   *  "unassigned queue" RLS branch; invisible to Org Agents). */
  assigned_agent_id?: string | null;
  assigned_team_id?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Match Radar (migration 094) ─────────────────────────────

/** One matched target inside a match_events row — a contact match for
 *  'new_property' events, a property match for 'buyer_updated' events. */
export interface MatchEventTarget {
  id: string;
  name: string;
  /** Phone for contact targets; property_code for property targets. */
  detail: string | null;
  score: number;
  /** Honest chips from the matching engine's MatchDetails. */
  chips: string[];
}

export interface MatchEvent {
  id: string;
  account_id: string;
  kind: 'new_property' | 'buyer_updated';
  property_id: string | null;
  contact_id: string | null;
  matches: MatchEventTarget[];
  status: 'new' | 'sent' | 'dismissed';
  sent_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  /** 'deal_mode' = cross-tenant Owners Den event (migration 134): the
   *  subject property belongs to ANOTHER tenant and is only visible
   *  through subject_snapshot until unlocked. */
  source?: 'internal' | 'deal_mode';
  /** Masked property snapshot for deal_mode events — see
   *  src/lib/den/masking.ts MaskedPropertySnapshot. */
  subject_snapshot?: import('@/lib/den/masking').MaskedPropertySnapshot | null;
  /** Hydrated by page queries, not stored columns. For deal_mode
   *  events this stays null (RLS blocks the cross-tenant join). */
  property?: Property | null;
  contact?: Contact | null;
}

// ── Showcase Pulse (migration 095) ──────────────────────────

export interface ShowcaseEvent {
  id: string;
  account_id: string;
  contact_id: string | null;
  property_id: string | null;
  session_key: string;
  event_type: 'open' | 'view_property' | 'map_click' | 'gallery';
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ContactTag {
  id: string;
  contact_id: string;
  tag_id: string;
}

export interface CustomField {
  id: string;
  user_id: string;
  field_name: string;
  field_type: string;
  field_options?: Record<string, unknown>;
  created_at: string;
}

export interface ContactCustomValue {
  id: string;
  contact_id: string;
  custom_field_id: string;
  value?: string;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  user_id: string;
  note_text: string;
  is_completed: boolean;
  created_at: string;
  updated_at?: string;
}

export type CallDirection = 'outbound' | 'inbound';
export type CallOutcome =
  | 'connected'
  | 'no_answer'
  | 'busy'
  | 'voicemail'
  | 'wrong_number'
  | 'callback_requested';

export interface CallLog {
  id: string;
  account_id: string;
  contact_id: string;
  user_id: string;
  called_at: string;
  direction: CallDirection;
  duration_seconds: number | null;
  outcome: CallOutcome;
  notes: string | null;
  created_at: string;
}

export type ConversationStatus = 'open' | 'pending' | 'closed';

export interface Conversation {
  id: string;
  user_id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_agent_id?: string | null;
  /** Org hierarchy (migration 082) — routing-engine assignment fields. */
  assigned_team_id?: string | null;
  assigned_by?: string | null;
  routing_rule_used?: string | null;
  assigned_at?: string | null;
  last_message_text?: string;
  last_message_at?: string;
  unread_count: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  contact?: Contact;
}

// ============================================================
// Org hierarchy (migration 082_org_hierarchy.sql)
// ============================================================

export interface Team {
  id: string;
  account_id: string;
  name: string;
  leader_id: string | null;
  created_at: string;
  updated_at: string;
}

export type RoutingRuleType =
  | 'locality_match'
  | 'source_match'
  | 'keyword_match'
  | 'round_robin'
  | 'fallback';

export interface RoutingRule {
  id: string;
  account_id: string;
  rule_type: RoutingRuleType;
  match_value: string | null;
  target_team_id: string | null;
  target_agent_id: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
}

export type SenderType = 'customer' | 'agent' | 'bot';
export type ContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template'
  /** Customer tapped a reply button or list row on a message we sent. */
  | 'interactive';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id?: string;
  content_type: ContentType;
  content_text?: string;
  media_url?: string;
  template_name?: string;
  message_id?: string;
  status: MessageStatus;
  created_at: string;
  reply_to_message_id?: string;
  /**
   * Only set when `content_type === 'interactive'` — the stable id of
   * the button or list row the customer tapped. The Flows engine uses
   * this to route the next node; the inbox bubble uses it as a styling
   * cue (renders with a "↩ button reply" affordance).
   */
  interactive_reply_id?: string;
  /**
   * Error information when message delivery fails.
   * Contains user-friendly error details from Meta API.
   */
  error_info?: string;
}

export type ReactionActor = 'customer' | 'agent';

export interface MessageReaction {
  id: string;
  message_id: string;
  conversation_id: string;
  actor_type: ReactionActor;
  actor_id?: string;
  emoji: string;
  created_at: string;
}

export interface WhatsAppConfig {
  id: string;
  user_id: string;
  phone_number_id: string;
  waba_id?: string;
  access_token: string;
  verify_token?: string;
  status: 'connected' | 'disconnected';
  connected_at?: string;
  /**
   * Set when POST /{phone_number_id}/register last succeeded. NULL
   * means the number was saved but never actually subscribed for
   * webhooks on Meta's side — inbound events will be silently lost.
   */
  registered_at?: string;
  /** Set when POST /{waba_id}/subscribed_apps last succeeded. */
  subscribed_apps_at?: string;
  /** Last error from /register; cleared on success. */
  last_registration_error?: string;
  catalog_id?: string;
  auto_sync_catalog?: boolean;
  integration_type?: 'sandbox' | 'web_qr' | 'official_api';
  trial_ends_at?: string | null;
  sandbox_code?: string | null;
  sandbox_message_count?: number;
  sandbox_message_limit?: number;
  migrated_from_sandbox_at?: string | null;
  migrated_sandbox_code?: string | null;
}

export interface SandboxSenderMapping {
  sender_phone: string;
  account_id: string;
  sandbox_code: string;
  created_at?: string;
  updated_at?: string;
  last_message_at?: string | null;
}

export interface SandboxSystemTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  header_type?: string | null;
  header_text?: string | null;
  footer?: string | null;
  buttons?: unknown;
  created_at?: string;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  updated_at?: string;
}

// Raw Meta status enum. We persist this verbatim from Meta (sync + webhook)
// rather than collapsing to a local TitleCase set — distinctions like
// PAUSED vs DISABLED vs IN_APPEAL drive the edit/resubmit/delete flows.
// DRAFT is the local-only state before the row is submitted to Meta.
export type MessageTemplateStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'IN_APPEAL'
  | 'PENDING_DELETION';

export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string }
  | { type: 'COPY_CODE'; text: string; example: string };

export interface TemplateSampleValues {
  body?: string[];
  header?: string[];
}

export interface MessageTemplate {
  id: string;
  user_id: string;
  name: string;
  category: 'Marketing' | 'Utility' | 'Authentication';
  language?: string;
  header_type?: 'text' | 'image' | 'video' | 'document';
  header_content?: string;
  header_handle?: string;
  header_media_url?: string;
  body_text: string;
  footer_text?: string;
  buttons?: TemplateButton[];
  sample_values?: TemplateSampleValues;
  status?: MessageTemplateStatus;
  meta_template_id?: string;
  rejection_reason?: string;
  quality_score?: 'GREEN' | 'YELLOW' | 'RED';
  submission_error?: string;
  last_submitted_at?: string;
  created_at: string;
}

export interface Pipeline {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  color: string;
  created_at: string;
}

export type DealStatus = 'open' | 'won' | 'lost';

export interface Deal {
  id: string;
  user_id: string;
  pipeline_id: string;
  stage_id: string;
  /**
   * Nullable after migration 004 — becomes NULL when the referenced
   * contact is deleted (ON DELETE SET NULL). History preserved.
   */
  contact_id: string | null;
  conversation_id?: string;
  assigned_to?: string;
  title: string;
  value: number;
  currency?: string;
  notes?: string;
  expected_close_date?: string;
  status?: DealStatus;
  created_at: string;
  updated_at?: string;
  property_id?: string | null;
  property?: Property;
  contact?: Contact;
  stage?: PipelineStage;
  assignee?: Profile;
  brokerage_type?: 'percentage' | 'fixed' | null;
  brokerage_value?: number | null;
  brokerage_amount?: number | null;
}

// ── Journey Mind Map (migration 131) ────────────────────────

export interface JourneyStage {
  id: string;
  account_id: string;
  name: string;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export type JourneyItemStatus = 'active' | 'dropped';

/** How a journey item landed on the map (migration 138). */
export type JourneyItemSource =
  | 'manual'
  | 'whatsapp_share'
  | 'chat_import'
  | 'inquiry_import';

/** One contact×property pair on the Journey mind map. `stage_id` is the
 *  FURTHEST stage reached; status 'dropped' means it exited at that
 *  stage (with `drop_reason`). Buyer view groups by contact_id, seller
 *  view groups by property_id — same rows, both directions. `hidden`
 *  items stay off the canvas and wait in the Captured tray. */
export interface JourneyItem {
  id: string;
  account_id: string;
  contact_id: string;
  property_id: string;
  stage_id: string;
  status: JourneyItemStatus;
  source: JourneyItemSource;
  hidden: boolean;
  drop_reason?: string | null;
  dropped_at?: string | null;
  /** Planned next step (migration 142) — ghost node on the map until
   *  reached or cleared; any stage move clears it. */
  planned_stage_id?: string | null;
  planned_at?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  /** Hydrated by page queries, not stored columns. */
  contact?: Contact | null;
  property?: Property | null;
}

export type JourneyEventType =
  | 'added'
  | 'advanced'
  | 'moved'
  | 'dropped'
  | 'reactivated'
  | 'hidden'
  | 'unhidden'
  | 'planned'
  | 'plan_cleared';

export interface JourneyEvent {
  id: string;
  account_id: string;
  item_id: string;
  event_type: JourneyEventType;
  from_stage_id?: string | null;
  to_stage_id?: string | null;
  reason?: string | null;
  created_by?: string | null;
  created_at: string;
}

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type RecipientStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'rate_limited';

export interface Broadcast {
  id: string;
  user_id: string;
  name: string;
  template_name: string;
  template_language: string;
  template_variables?: Record<string, unknown>;
  audience_filter?: Record<string, unknown>;
  scheduled_at?: string;
  status: BroadcastStatus;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  created_at: string;
}

export interface BroadcastRecipient {
  id: string;
  broadcast_id: string;
  /**
   * Nullable after migration 004 — becomes NULL when the referenced
   * contact is deleted (ON DELETE SET NULL). History preserved; the
   * UI renders "Unknown" for orphaned rows.
   */
  contact_id: string | null;
  status: RecipientStatus;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  replied_at?: string;
  error_message?: string;
  retry_count?: number;
  retry_after?: string | null;
  /**
   * Meta's message id, persisted when the broadcast send succeeds so
   * the webhook can mirror status updates back onto the recipient row.
   * Added in migration 003.
   */
  whatsapp_message_id?: string;
  created_at: string;
  contact?: Contact;
}

// ============================================================
// Automations (migration 006)
// ============================================================

export type AutomationTriggerType =
  | 'new_message_received'
  | 'first_inbound_message'
  | 'keyword_match'
  | 'new_contact_created'
  | 'conversation_assigned'
  | 'tag_added'
  | 'time_based';

export type AutomationStepType =
  | 'send_message'
  | 'send_template'
  | 'add_tag'
  | 'remove_tag'
  | 'assign_conversation'
  | 'update_contact_field'
  | 'create_deal'
  | 'wait'
  | 'condition'
  | 'send_webhook'
  | 'close_conversation';

export type AutomationLogStatus = 'success' | 'partial' | 'failed';

export interface KeywordMatchTriggerConfig {
  keywords: string[];
  match_type: 'exact' | 'contains';
  case_sensitive?: boolean;
}

export interface TagTriggerConfig {
  tag_id: string;
}

export interface TimeBasedTriggerConfig {
  /** Cron expression or simple HH:mm string; engine can accept either. */
  schedule: string;
  timezone?: string;
}

export type AutomationTriggerConfig =
  | Record<string, never>
  | KeywordMatchTriggerConfig
  | TagTriggerConfig
  | TimeBasedTriggerConfig
  | Record<string, unknown>;

export interface SendMessageStepConfig {
  text: string;
}

export interface SendTemplateStepConfig {
  template_name: string;
  language?: string;
  variables?: Record<string, string>;
}

export interface TagStepConfig {
  tag_id: string;
}

export interface AssignConversationStepConfig {
  mode: 'specific' | 'round_robin';
  agent_id?: string;
}

export interface UpdateContactFieldStepConfig {
  field: string;
  value: string;
}

export interface CreateDealStepConfig {
  pipeline_id: string;
  stage_id: string;
  title: string;
  value?: number;
}

export interface WaitStepConfig {
  amount: number;
  unit: 'minutes' | 'hours' | 'days';
}

export type ConditionSubject =
  | 'contact_field'
  | 'tag_presence'
  | 'message_content'
  | 'time_of_day';

export interface ConditionStepConfig {
  subject: ConditionSubject;
  /** e.g. field name, tag id, substring, or "HH:mm-HH:mm" depending on subject */
  operand?: string;
  /** For contact_field equals / message_content contains — comparison value */
  value?: string;
}

export interface SendWebhookStepConfig {
  url: string;
  headers?: Record<string, string>;
  body_template?: string;
}

export type AutomationStepConfig =
  | SendMessageStepConfig
  | SendTemplateStepConfig
  | TagStepConfig
  | AssignConversationStepConfig
  | UpdateContactFieldStepConfig
  | CreateDealStepConfig
  | WaitStepConfig
  | ConditionStepConfig
  | SendWebhookStepConfig
  | Record<string, never>
  | Record<string, unknown>;

export interface Automation {
  id: string;
  /** Account tenancy key — every automation belongs to one account
   *  (migration 017 made the column NOT NULL). The engine looks up
   *  active automations by this field on inbound webhook events. */
  account_id: string;
  /** Original author. Used for log audit + outbound message
   *  sender-of-record, never for tenancy isolation. */
  user_id: string;
  name: string;
  description?: string;
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  is_active: boolean;
  execution_count: number;
  last_executed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationStep {
  id: string;
  automation_id: string;
  parent_step_id?: string | null;
  branch?: 'yes' | 'no' | null;
  step_type: AutomationStepType;
  step_config: AutomationStepConfig;
  position: number;
  created_at: string;
}

export interface AutomationLogStepResult {
  step_id: string;
  step_type: AutomationStepType;
  status: 'success' | 'skipped' | 'failed';
  detail?: string;
}

export interface AutomationLog {
  id: string;
  automation_id: string;
  user_id: string;
  contact_id: string | null;
  trigger_event: string;
  steps_executed: AutomationLogStepResult[];
  status: AutomationLogStatus;
  error_message?: string | null;
  created_at: string;
  contact?: Contact;
}

// ============================================================
// Real Estate Inventory (021_real_estate_inventory.sql)
// ============================================================

export interface Property {
  id: string;
  account_id: string;
  user_id: string | null;
  title: string;
  description?: string;
  price: number;
  /** Final sale price captured when status → Sold. Optional, never buyer-facing. */
  sold_price?: number | null;
  location: string;
  type: string;
  status: string;
  listing_type?: 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit';
  rent_per_month?: number | null;
  maintenance?: number | null;
  advance?: number | null;
  gst?: number | null;
  /** JV/JD deal terms. */
  jv_structure?: 'Revenue Share' | 'Area Share' | 'Hybrid' | null;
  owner_share_percent?: number | null;
  builder_share_percent?: number | null;
  goodwill_amount?: number | null;
  /** Built to Suit lease terms. */
  bts_lease_years?: number | null;
  bts_lock_in_years?: number | null;
  bts_escalation_percent?: number | null;
  /** Land/JV deal notes (migration 118) — internal only, used to prefill
   *  the "Share via Email" draft. Never shown on the public showcase. */
  ownership_status?: string | null;
  land_use_zoning?: string | null;
  deal_remarks?: string | null;
  bedrooms?: number;
  bathrooms?: number;
  area_sqft?: number;
  area_unit?: string;
  land_area?: number;
  land_area_unit?: string;
  super_built_area?: number;
  sublocality?: string;
  city?: string;
  state?: string;
  project?: string;
  /** Locality coordinates (migration 093) — from the form's Places
   *  autocomplete pick or the server-side geocode fallback. */
  latitude?: number | null;
  longitude?: number | null;
  locality_place_id?: string | null;
  locality_canonical?: string | null;
  /** Transient fields attached by the tiered location search
   *  (GET /api/properties?near_lat=...), not stored columns. */
  distance_km?: number | null;
  location_tier?: 'exact' | 'nearby';
  land_zone?: string;
  ideal_for?: string;
  dimensions?: string;
  road_width?: number;
  road_width_unit?: string;
  facing_direction?: string;
  nearby_highlights?: string[];
  is_published: boolean;
  /** Account-wide star: shown as an interest-filter chip on Contacts (capped at 6). */
  is_starred?: boolean;
  features: string[];
  images: string[];
  /** Auto-generated listing teaser video (migration 151). */
  video_url?: string | null;
  video_status?: 'queued' | 'processing' | 'ready' | 'failed' | null;
  video_language?: string | null;
  video_error?: string | null;
  video_generated_at?: string | null;
  /** Unlisted YouTube copy of the listing video (migration 153). */
  youtube_video_id?: string | null;
  youtube_status?: 'queued' | 'uploading' | 'ready' | 'failed' | null;
  youtube_error?: string | null;
  youtube_uploaded_at?: string | null;
  documents?: string[];
  google_map_link?: string | null;
  property_code?: string;
  /** Internal agent notes — CRM-only, never shown on the public showcase. */
  notes?: string | null;
  owner_contact_id?: string | null;
  owner?: Contact | null;
  interested_contacts?: Contact[];
  /** Thumbs-up tally from public showcase visitors (migration 158). */
  like_count?: number;
  /** 1–10 buyer interest rating tallies from showcase visitors (migration 159). */
  rating_count?: number;
  rating_total?: number;
  rental_income?: number | null;
  roi?: number | null;
  /** Floor-wise rent roll for pre-leased commercial buildings
   *  (migration 130) — CRM-only, never shown on the public showcase.
   *  Shape: src/lib/inventory/floor-tenancies.ts FloorTenancy[]. */
  floor_tenancies?: import('@/lib/inventory/floor-tenancies').FloorTenancy[] | null;
  listing_source?: 'owner' | 'agent' | 'whatsapp_lister' | 'web_lister';
  /** Upstream property this listing was imported from via a co-broker
   *  share (migration 154) — cross-account lineage for indirect-reach
   *  counting. Never shown on the public showcase. */
  source_property_id?: string | null;
  /** Owners Den sell-readiness flag (migration 133). 'soft' = quietly
   *  open to offers (masked matching pool only), 'aggressive' =
   *  actively selling (matched buyers notified immediately). */
  deal_mode?: 'off' | 'soft' | 'aggressive';
  deal_mode_updated_at?: string | null;
  deal_mode_set_by?: 'owner' | 'staff' | null;
  /** Owner's optional floor for Deal Mode offers (migration 135). */
  min_bid?: number | null;
  agent_details?: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    avatar_url?: string | null;
  } | null;
  created_at: string;
  updated_at: string;
  meta_catalog_synced_at?: string | null;
  meta_catalog_error?: string | null;
}

// ============================================================
// Showcase Website Settings (033_add_showcase_settings.sql)
// ============================================================

export interface ShowcaseSettings {
  id: string;
  account_id: string;
  website_name: string;
  website_url: string;
  contact_phone: string;
  whatsapp_message_template: string;
  flyer_ai_provider?: 'google' | 'huggingface';
  currency?: string;
  default_country_code?: string;
  meta_pixel_id?: string | null;
  subdomain?: string | null;
  theme?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Email Sync Settings (059_create_email_sync_configs.sql)
// ============================================================

export interface EmailSyncConfig {
  id: string;
  account_id: string;
  is_active: boolean;
  auto_reply_enabled: boolean;
  auto_reply_text: string | null;
  auto_reply_template_name: string | null;
  last_verification_code: string | null;
  last_verification_link: string | null;
  last_verification_at: string | null;
  created_at: string;
  updated_at: string;
}



// ============================================================
// Liaisoning People Directory (147_liaisons.sql)
// ============================================================

/** One service a liaison handles, with the fee they quoted for it. */
export interface LiaisonService {
  /** e.g. "Khata transfer", "New khata", "EC", "Registration" */
  name: string;
  /** What the liaison charges us, in INR. Null when it varies case-by-case. */
  fee: number | null;
  /** What we bill the client for this service, in INR. Margin = client_charge - fee. */
  client_charge?: number | null;
  /** Qualifier for the fee, e.g. "per property, excl. govt charges". */
  fee_note?: string | null;
}

export interface Liaison {
  id: string;
  account_id: string;
  user_id?: string | null;
  name: string;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  /** Where they operate: "BBMP Bommanahalli", "SRO Jayanagar", ... */
  office_area: string | null;
  services: LiaisonService[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type LiaisonJobStatus = 'open' | 'completed' | 'cancelled';

/** One actual engagement with a liaison (148_liaison_jobs.sql). */
export interface LiaisonJob {
  id: string;
  account_id: string;
  user_id?: string | null;
  liaison_id: string;
  /** Snapshot — rate-card entries get renamed, jobs keep their label. */
  service_name: string;
  contact_id: string | null;
  property_id: string | null;
  /** Agreed for this job; may differ from the directory rate card. */
  client_charge: number | null;
  liaison_fee: number | null;
  status: LiaisonJobStatus;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined rows from client-side reads. */
  liaisons?: { name: string } | null;
  contacts?: { id: string; name: string | null; phone: string } | null;
  properties?: { id: string; title: string } | null;
  liaison_job_payments?: LiaisonJobPayment[];
}

/** Cash movement on a job: 'in' from client, 'out' to the liaison. */
export interface LiaisonJobPayment {
  id: string;
  account_id: string;
  job_id: string;
  user_id?: string | null;
  direction: 'in' | 'out';
  amount: number;
  paid_on: string;
  note: string | null;
  created_at: string;
}

/** One stage of a liaison process workflow (149_liaison_workflows.sql). */
export interface LiaisonWorkflowStage {
  /** e.g. "Case login", "ARO approval" */
  name: string;
  /** Who acts/approves at this stage: "Case worker", "ARO", "JD", "DC". */
  authority: string | null;
  /** Indicative duration in days. Null when it varies. */
  duration_days: number | null;
  /** Client-facing explanation of what happens in this stage. */
  description: string | null;
}

/** Client-shareable explanation of a government process, stage by stage. */
export interface LiaisonWorkflow {
  id: string;
  account_id: string;
  user_id?: string | null;
  service_name: string;
  description: string | null;
  /** Array order is the process order. */
  stages: LiaisonWorkflowStage[];
  created_at: string;
  updated_at: string;
}
