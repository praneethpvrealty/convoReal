import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api';
import { leadFirstName } from '@/lib/contacts/lead-placeholder';
import { questionSubjectProperties } from '@/lib/ai/lead-question';
import { resolvePropertySubject } from '@/lib/learning/subject';
import type { Property } from '@/types';

/**
 * Regex matching phrases where a lead indicates that they are not
 * interested in a property or current options shown to them.
 */
const DISINTEREST_PATTERNS = [
  /\b(?:i(?:'m| am)?\s+)?not\s+interested\b/i,
  /\b(?:i(?:'m| am)?\s+)?not\s+(?:for\s+me|for\s+us)\b/i,
  /\b(?:i\s+)?(?:don'?t|dont|do\s+not)\s+(?:like|want|prefer)\s+(?:this|it|the\s+property|these)\b/i,
  /\b(?:not\s+looking\s+for\s+(?:this|that|these)|not\s+what\s+i(?:'m|\s+am)?\s+looking\s+for)\b/i,
  /\b(?:not\s+(?:suitable|fitting|matching)(?:\s+(?:for\s+me|for\s+us))?)\b/i,
  /\b(?:doesn'?t|doesnt|does\s+not)\s+(?:suit|fit|work|match)(?:\s+(?:for\s+me|for\s+us|me|my\s+requirement))?\b/i,
  /\b(?:no\s+this\s+(?:doesn'?t|doesnt)\s+work|no\s+not\s+this|no\s+i\s+don'?t\s+want\s+this)\b/i,
  /\b(?:pass\s+on\s+this|drop\s+this|skip\s+this(?:\s+one)?|reject\s+this)\b/i,
];

export function isPropertyDisinterest(text?: string | null): boolean {
  const value = (text || '').trim();
  if (!value) return false;
  return DISINTEREST_PATTERNS.some((pattern) => pattern.test(value));
}

export function buildPropertyDisinterestBody(
  contactName?: string | null,
  propertyTitle?: string | null
): string {
  const name = leadFirstName(contactName);
  const greeting = name ? `Understood ${name} — ` : 'Understood — ';
  const subjectRef = propertyTitle
    ? `I've noted that *${propertyTitle}* isn't what you're looking for.`
    : `I've noted that this property isn't what you're looking for.`;

  return `${greeting}${subjectRef}\n\nTo help me find better options, what factor didn't fit?\n• *Property Type* (want a plot, villa, apartment, or single house)\n• *Budget / Price* (too high or out of range)\n• *Location* (prefer a different locality)\n• *Size / Layout* (need different dimensions or BHK)\n\n👉 Tap an option below, or simply reply by typing what you're looking for.`;
}

export function buildPropertyDisinterestSections(
  propertyId?: string | null
): InteractiveListSection[] {
  const targetId = propertyId || '';
  return [
    {
      rows: [
        {
          id: `lfbr_type_${targetId}`,
          title: '🏢 Wrong property type',
          description: 'Looking for plot, villa, flat or independent house',
        },
        {
          id: `lfbr_budget_${targetId}`,
          title: '💰 Budget too high',
          description: 'Price is out of range',
        },
        {
          id: `lfbr_location_${targetId}`,
          title: '📍 Wrong location',
          description: 'Prefer other areas or localities',
        },
        {
          id: `lfbr_size_${targetId}`,
          title: '📐 Size or layout',
          description: 'Need different dimensions, plot size or BHK',
        },
        {
          id: `lfbr_other_${targetId}`,
          title: '✏️ Something else',
          description: 'Facing, condition, or other factors',
        },
      ],
    },
  ];
}

/**
 * Handles an inbound message expressing disinterest in a property.
 * Resolves the subject property, records the rejection on listing_feedback,
 * and replies with an interactive factor prompt + open typing invitation.
 */
export async function handlePropertyDisinterestMessage(args: {
  db: SupabaseClient;
  accountId: string;
  configOwnerUserId: string;
  contact: {
    id: string;
    name?: string | null;
    last_inquired_property_id?: string | null;
  };
  conversationId: string;
  inboundText: string;
  quotedPropertyId?: string | null;
}): Promise<boolean> {
  const {
    db,
    accountId,
    configOwnerUserId,
    contact,
    conversationId,
    inboundText,
    quotedPropertyId,
  } = args;

  let subjectProperty: Pick<Property, 'id' | 'title'> | null = null;

  // 1. Quoted property id from quote-reply context
  if (quotedPropertyId) {
    const { data } = await db
      .from('properties')
      .select('id, title')
      .eq('id', quotedPropertyId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (data) subjectProperty = data;
  }

  // 2. Question/subject resolver
  if (!subjectProperty) {
    const subjects = await questionSubjectProperties(
      db,
      accountId,
      contact.id,
      conversationId,
      inboundText
    );
    if (subjects.length > 0) {
      subjectProperty = subjects[0];
    }
  }

  // 3. Thread property subject
  if (!subjectProperty) {
    const propId = await resolvePropertySubject(
      db,
      accountId,
      contact.id,
      conversationId
    );
    if (propId) {
      const { data } = await db
        .from('properties')
        .select('id, title')
        .eq('id', propId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (data) subjectProperty = data;
    }
  }

  // 4. Last inquired property on contact
  if (!subjectProperty && contact.last_inquired_property_id) {
    const { data } = await db
      .from('properties')
      .select('id, title')
      .eq('id', contact.last_inquired_property_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (data) subjectProperty = data;
  }

  // Record rejection if a subject property was identified
  if (subjectProperty?.id) {
    try {
      await db.from('listing_feedback').upsert(
        {
          account_id: accountId,
          contact_id: contact.id,
          property_id: subjectProperty.id,
          verdict: 'rejected',
        },
        { onConflict: 'contact_id,property_id' }
      );
    } catch (err) {
      console.error('[property-disinterest] feedback recording failed:', err);
    }
  }

  const bodyText = buildPropertyDisinterestBody(
    contact.name,
    subjectProperty?.title
  );

  const sections = buildPropertyDisinterestSections(subjectProperty?.id);

  const result = await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: contact.id,
    conversationId,
    kind: 'interactive',
    senderType: 'bot',
    interactiveType: 'list',
    interactiveBody: bodyText,
    interactiveButtonLabel: 'Select factor',
    interactiveSections: sections,
    customDbClient: db,
  });

  return result.success;
}
