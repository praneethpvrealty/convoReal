import { createHash } from 'node:crypto';

import type { JourneyEventType } from '@/types';

export type PersonalWhatsAppSource = 'web' | 'mobile';

interface PersonalJourneyEventArgs {
  itemId: string;
  message: string;
  source: PersonalWhatsAppSource;
  senderId: string | null;
}

export interface PersonalWhatsAppJourneyMetadataArgs {
  source: PersonalWhatsAppSource;
  senderType: 'user' | 'bot' | 'agent';
  senderId: string | null;
  itemId: string;
  contactId: string;
  propertyId: string | null;
  conversationId: string | null;
  message: string;
}

export interface PersonalWhatsAppJourneyMessageRow {
  contentType: string;
  contentText: string | null;
  templateName: string | null;
}

export interface PersonalJourneyEventPayload {
  accountId: string;
  itemId: string;
  eventType: JourneyEventType;
  createdBy: string | null;
  dedupeKey: string;
  metadata: {
    channel: 'personal_whatsapp';
    source: PersonalWhatsAppSource;
    sender_type: 'user' | 'bot' | 'agent';
    sender_id: string | null;
    item_id: string;
    contact_id: string;
    property_id: string | null;
    conversation_id: string | null;
    message: string;
    message_length: number;
  };
}

export function cleanJourneyMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function personalJourneyDedupeKey({
  itemId,
  message,
  source,
  senderId,
}: PersonalJourneyEventArgs): string {
  return createHash('sha256')
    .update(`${itemId}|${source}|${senderId ?? ''}|${message}`)
    .digest('hex');
}

export function buildPersonalWhatsAppJourneyMetadata({
  source,
  senderType,
  senderId,
  itemId,
  contactId,
  propertyId,
  conversationId,
  message,
}: PersonalWhatsAppJourneyMetadataArgs) {
  return {
    channel: 'personal_whatsapp' as const,
    source,
    sender_type: senderType,
    sender_id: senderId,
    item_id: itemId,
    contact_id: contactId,
    property_id: propertyId,
    conversation_id: conversationId,
    message,
    message_length: message.length,
  };
}

export function inferPersonalWhatsAppJourneyMessage({
  contentType,
  contentText,
  templateName,
}: PersonalWhatsAppJourneyMessageRow): string | null {
  if (contentType === 'template') {
    return contentText || (templateName ? `[template:${templateName}]` : null);
  }

  if (contentType === 'media' || contentType === 'audio' || contentType === 'video' || contentType === 'document' || contentType === 'image' || contentType === 'location') {
    return contentText || '[media]';
  }

  if (contentType === 'interactive') {
    return contentText || '[interactive]';
  }

  return contentText || null;
}
