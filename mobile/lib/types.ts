/**
 * Mobile-side mirrors of the web app's types (src/types/index.ts),
 * trimmed to the columns the app reads. Keep field names identical to
 * the web definitions — they are the DB column names. When the mobile
 * build is wired into the monorepo's TS project references, replace
 * this file with direct imports from ../src/types.
 */

export type ConversationStatus = 'open' | 'pending' | 'closed';

export const CLASSIFICATIONS = [
  'Owner',
  'Seller',
  'Buyer',
  'Agent',
  'Developer',
  'Owner & Buyer',
  'Others',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export interface Contact {
  id: string;
  phone: string;
  secondary_phones?: string[];
  name?: string;
  name_tag?: string | null;
  email?: string;
  company?: string;
  classification?: Classification;
  avatar_url?: string;
  min_budget?: number | null;
  max_budget?: number | null;
  no_budget?: boolean;
  areas_of_interest?: string[];
  requirements?: string | null;
  lead_temp?: 'HOT' | 'COLD' | 'Not Responding' | 'Dead' | null;
}

export interface Conversation {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_agent_id?: string | null;
  last_message_text?: string;
  last_message_at?: string;
  unread_count: number;
  is_archived: boolean;
  contact?: Contact;
}

export type SenderType = 'customer' | 'agent' | 'bot';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  content_type:
    | 'text'
    | 'image'
    | 'document'
    | 'audio'
    | 'video'
    | 'location'
    | 'template'
    | 'interactive';
  content_text?: string;
  /** Relative proxy path — resolve with absoluteMediaUrl(). */
  media_url?: string;
  status: MessageStatus;
  created_at: string;
  error_info?: string;
}

export interface Profile {
  account_id: string;
  account_role: string;
}

// ------------------------------------------------------------------
// Inventory (properties table; list served by GET /api/properties)
// ------------------------------------------------------------------

export interface Property {
  id: string;
  title: string;
  property_code?: string | null;
  description?: string | null;
  price?: number | null;
  rent_per_month?: number | null;
  location?: string | null;
  sublocality?: string | null;
  city?: string | null;
  type?: string | null;
  status?: string | null;
  listing_type?: 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit' | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_sqft?: number | null;
  area_unit?: string | null;
  land_area?: number | null;
  land_area_unit?: string | null;
  facing_direction?: string | null;
  features?: string[] | null;
  /** Public Supabase Storage URLs, renderable directly. */
  images?: string[] | null;
  is_published?: boolean;
  is_starred?: boolean;
  google_map_link?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  listing_source?: string | null;
  sublocality_2?: string | null;
  super_built_area?: number | null;
  dimensions?: string | null;
  road_width?: number | null;
  road_width_unit?: string | null;
  land_zone?: string | null;
  ideal_for?: string | null;
  ownership_status?: string | null;
  rental_income?: number | null;
  nearby_highlights?: string[] | null;
  notes?: string | null;
  floor_tenancies?:
    | {
        floor?: string | null;
        tenant_name?: string | null;
        area_sqft?: number | string | null;
        monthly_rent?: number | string | null;
        lease_start?: string | null;
        lease_end?: string | null;
        lock_in_months?: number | string | null;
        maintenance?: string | null;
        notes?: string | null;
      }[]
    | null;
  owner_contact_id?: string | null;
  owner?: { name?: string | null; phone?: string | null } | null;
  created_at?: string;
  /** Injected by /api/properties near-search responses. */
  distance_km?: number;
  location_tier?: 'exact' | 'nearby';
}

/** A locality picked from the Google-backed autocomplete proxy. */
export interface PickedLocality {
  place_id: string;
  label: string;
  latitude: number;
  longitude: number;
}

export interface PropertiesResponse {
  data: Property[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ------------------------------------------------------------------
// Pipelines / deals (direct RLS-scoped reads, like the web kanban)
// ------------------------------------------------------------------

export interface Pipeline {
  id: string;
  name: string;
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  color?: string | null;
}

export interface Deal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id?: string | null;
  conversation_id?: string | null;
  property_id?: string | null;
  title: string;
  value?: number | null;
  currency?: string | null;
  status: 'open' | 'won' | 'lost';
  expected_close_date?: string | null;
  contact?: Contact | null;
  property?: Property | null;
}

// ------------------------------------------------------------------
// Calendar (appointments table — direct reads/inserts, like the web)
// ------------------------------------------------------------------

export type AppointmentType =
  | 'site_visit'
  | 'call'
  | 'follow_up'
  | 'document'
  | 'meeting'
  | 'other';

export interface Appointment {
  id: string;
  title: string;
  description?: string | null;
  start_time: string;
  end_time?: string | null;
  location?: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  event_type: AppointmentType;
  contact_id?: string | null;
  contact_ids?: string[] | null;
  property_id?: string | null;
  agenda?: string | null;
  contact?: Contact | null;
  property?: { id: string; title: string; location?: string | null } | null;
}

// ------------------------------------------------------------------
// Broadcasts (user_id-scoped RLS — you see campaigns YOU created)
// ------------------------------------------------------------------

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

export interface Broadcast {
  id: string;
  name: string;
  template_name?: string | null;
  status: BroadcastStatus;
  scheduled_at?: string | null;
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
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'rate_limited';
  error_message?: string | null;
  contact?: Contact | null;
}

// ------------------------------------------------------------------
// Automations & Flows (user_id-scoped; toggled via API routes)
// ------------------------------------------------------------------

export interface AutomationRow {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: string;
  is_active: boolean;
  execution_count?: number | null;
  last_executed_at?: string | null;
}

export interface FlowRow {
  id: string;
  name: string;
  description?: string | null;
  status: 'draft' | 'active' | 'archived';
  trigger_type?: string | null;
  execution_count?: number | null;
}

// ------------------------------------------------------------------
// Journey (account-scoped; read-only list on mobile)
// ------------------------------------------------------------------

export interface JourneyStage {
  id: string;
  name: string;
  color?: string | null;
  position: number;
}

export interface JourneyItem {
  id: string;
  contact_id: string;
  property_id: string;
  stage_id: string;
  status: 'active' | 'dropped';
  drop_reason?: string | null;
  hidden: boolean;
  updated_at?: string;
  contact?: Contact | null;
  property?: { id: string; title: string } | null;
}

// ------------------------------------------------------------------
// WhatsApp templates (message_templates, status APPROVED)
// ------------------------------------------------------------------

export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  category?: string | null;
  header_type?: 'text' | 'image' | 'video' | 'document' | null;
  header_content?: string | null;
  body_text: string;
  footer_text?: string | null;
  status: string;
}
