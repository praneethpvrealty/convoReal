import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact, Property } from '@/types';
import { resolveConversation } from '@/lib/conversations/resolve';
import { buildCheckInMessage } from '@/lib/journey/checkin-message';
import { accountPropertyShowcaseUrl } from '@/lib/showcase/account-showcase-url';
import {
  buildClosedWindowFollowUpTemplateSend,
  pickClosedWindowFollowUpTemplate,
  type ClosedWindowFollowUpTemplateRow,
} from '@/lib/contacts/follow-up-nudges';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { ENQUIRY_FOLLOWUP_TEMPLATE_NAMES } from '@/lib/whatsapp/enquiry-followup-template';
import { JOURNEY_CHECKIN_TEMPLATE_NAMES } from '@/lib/whatsapp/journey-checkin-template';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  narrowToLanguage,
  resolveSendLanguage,
} from '@/lib/whatsapp/template-language';

export interface PropertyInterestFollowUpTarget {
  contact: Pick<Contact, 'id' | 'name' | 'phone'>;
  property: Property;
}

export interface PropertyInterestFollowUpResult {
  success: boolean;
  delivery?: 'free_text' | 'template';
  message: string;
  error?: string;
}

export async function buildPropertyInterestFollowUpMessage(args: {
  db: SupabaseClient;
  accountId: string;
  target: PropertyInterestFollowUpTarget;
}): Promise<string> {
  const { db, accountId, target } = args;
  const propertyUrl = await accountPropertyShowcaseUrl(
    db,
    accountId,
    target.property,
    target.contact.id
  );
  return buildCheckInMessage({
    contactName: target.contact.name,
    propertyTitle: target.property.title,
    propertyCode: target.property.property_code,
    propertyUrl,
  });
}

export async function sendPropertyInterestFollowUp(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  target: PropertyInterestFollowUpTarget;
}): Promise<PropertyInterestFollowUpResult> {
  const { db, accountId, userId, target } = args;
  const message = await buildPropertyInterestFollowUpMessage({
    db,
    accountId,
    target,
  });

  if (!target.contact.phone?.replace(/\D/g, '')) {
    return {
      success: false,
      message,
      error: 'This contact has no phone number.',
    };
  }

  const { conversation, error: conversationError } = await resolveConversation<{
    id: string;
  }>(db, {
    accountId,
    contactId: target.contact.id,
    userId,
    columns: 'id',
  });
  if (!conversation) {
    return {
      success: false,
      message,
      error: conversationError?.message || 'Could not open the contact thread.',
    };
  }

  const { data: lastCustomer } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (isWithinCustomerWindow(lastCustomer?.created_at)) {
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId: target.contact.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'agent',
      text: message,
      customDbClient: db,
    });
    return {
      success: result.success,
      delivery: result.success ? 'free_text' : undefined,
      message,
      error: result.error,
    };
  }

  const language = await resolveSendLanguage(db, accountId, target.contact.id);
  const { data: rows } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .in('name', [
      ...JOURNEY_CHECKIN_TEMPLATE_NAMES,
      ...ENQUIRY_FOLLOWUP_TEMPLATE_NAMES,
    ]);
  const choice = pickClosedWindowFollowUpTemplate(
    narrowToLanguage(
      (rows ?? []) as ClosedWindowFollowUpTemplateRow[],
      language
    ),
    true
  );
  if (!choice) {
    return {
      success: false,
      message,
      error:
        'The 24-hour window is closed and no approved Utility check-in template is available. Use personal WhatsApp instead.',
    };
  }

  const { data: account } = await db
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();
  const templateSend = buildClosedWindowFollowUpTemplateSend(choice, {
    contactName: target.contact.name ?? null,
    accountName: (account as { name?: string | null } | null)?.name ?? null,
    contactId: target.contact.id,
    property: target.property,
  });
  const result = await sendWhatsAppMessageAndPersist({
    accountId,
    userId,
    contactId: target.contact.id,
    conversationId: conversation.id,
    kind: 'template',
    senderType: 'agent',
    ...templateSend,
    templateRow: choice.template,
    customDbClient: db,
  });
  return {
    success: result.success,
    delivery: result.success ? 'template' : undefined,
    message,
    error: result.error,
  };
}
