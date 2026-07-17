/**
 * Mobile-side mirrors of the web app's types (src/types/index.ts),
 * trimmed to the columns the app reads. Keep field names identical to
 * the web definitions — they are the DB column names. When the mobile
 * build is wired into the monorepo's TS project references, replace
 * this file with direct imports from ../src/types.
 */

export type ConversationStatus = 'open' | 'pending' | 'closed';

export interface Contact {
  id: string;
  phone: string;
  name?: string;
  name_tag?: string | null;
  classification?: string;
  avatar_url?: string;
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
