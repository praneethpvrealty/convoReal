/**
 * Types shared with the web app, plus the mobile-only shapes.
 *
 * `Contact` and `Property` are re-exported straight from
 * src/types/index.ts via the @shared alias — they are DB row shapes,
 * and hand-copying them let columns drift: a field added on the web
 * was simply absent here, so mobile read it as undefined and wrote it
 * back as null. The web file is type-only, so this costs nothing at
 * runtime and nothing reaches the bundle.
 *
 * The rest below are mobile-only view models with no web counterpart.
 * Anything that IS a DB row shape belongs in src/types, not here.
 */

import type { Contact, Property } from '@shared/types';

export type { Contact, Property };

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

/** Coordinates for one area of interest, resolved via Google Places.
 *  `name` matches the entry in areas_of_interest (web parity). */
export interface AreaOfInterestGeo {
  name: string;
  lat: number;
  lng: number;
}

export interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  note_text: string;
  created_at: string;
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
  /** Set instead of `contact` when the thread is a WhatsApp group. A
   *  conversation is about exactly one of the two — see migration 218. */
  group?: WhatsAppGroup | null;
}

export interface WhatsAppGroup {
  id: string;
  subject: string;
  status: 'pending' | 'active' | 'suspended' | 'deleted' | 'failed';
}

/** The title a thread shows, whichever kind it is. */
export function conversationTitle(
  conversation: Pick<Conversation, 'contact' | 'group'> | null | undefined
): string {
  if (conversation?.group) return conversation.group.subject;
  return (
    conversation?.contact?.name || conversation?.contact?.phone || 'Conversation'
  );
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
  /** `messages.id` of the message this one quotes, when it is a reply. */
  reply_to_message_id?: string;
  /** Meta's own wamid, once WhatsApp has accepted the message. Absent
   *  while a send is queued and on anything that failed. */
  message_id?: string | null;
  /** Engine-local pin. Nothing changes on the contact's phone: the
   *  Cloud API's pin endpoint takes group recipients only. */
  pinned_at?: string | null;
  pinned_by?: string | null;
  /** Engine-local hide. The customer's copy is NOT deleted — Meta has
   *  no revoke endpoint — so this only removes the row from our inbox. */
  deleted_at?: string | null;
  deleted_by?: string | null;
}

export type ReactionActor = 'agent' | 'customer';

export interface MessageReaction {
  id: string;
  message_id: string;
  conversation_id: string;
  actor_type: ReactionActor;
  actor_id?: string | null;
  emoji: string;
  created_at: string;
}

export interface Profile {
  account_id: string;
  account_role: string;
  /** Org-hierarchy role (migration 082) — source of truth for the
   *  manager-only capabilities, e.g. hard-deleting a contact. */
  org_role?: string | null;
  full_name?: string | null;
}

// ------------------------------------------------------------------
// Inventory (properties table; list served by GET /api/properties)
// ------------------------------------------------------------------

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
  /** Type-specific notes (migration 128). `agenda` is filled while
   *  planning and rides along on the pre-event brief; `minutes` and
   *  `outcome` are logged after the event. Which of the three apply
   *  depends on event_type — see lib/event-fields. */
  agenda?: string | null;
  minutes?: string | null;
  outcome?: string | null;
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

// ------------------------------------------------------------------
// Showcase Pulse (showcase_events; read-only on mobile)
// ------------------------------------------------------------------

export type ShowcaseEventType = 'open' | 'view_property' | 'map_click' | 'gallery';

export interface ShowcaseEvent {
  id: string;
  contact_id: string | null;
  property_id: string | null;
  session_key: string;
  share_id?: string | null;
  event_type: ShowcaseEventType;
  metadata: { duration_ms?: number } & Record<string, unknown>;
  created_at: string;
}
