import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPropertyEnquiryCard } from '@/lib/whatsapp/enquiry-card';
import { createNotification } from '@/lib/notifications/create';
import { BRIDGE_REPLY_HINT } from '@/lib/whatsapp/reply-bridge';

export interface PropertyEnquiryAlert {
  db: SupabaseClient;
  accountId: string;
  agentUserId: string;
  propertyId: string;
  contactId: string;
  conversationId: string;
  leadName: string;
  leadPhone: string;
  enquiryText: string;
  referredByName?: string | null;
}

/**
 * Tells the routed agent about a deliberate property enquiry: the
 * Approve/Reject card on WhatsApp, with the bell and push beside it.
 */
export async function alertAgentOfPropertyEnquiry(
  args: PropertyEnquiryAlert
): Promise<void> {
  const cardSent = await sendPropertyEnquiryCard({
    db: args.db,
    accountId: args.accountId,
    agentUserId: args.agentUserId,
    propertyId: args.propertyId,
    contactId: args.contactId,
    leadName: args.leadName,
    leadPhone: args.leadPhone,
    enquiryText: args.enquiryText,
  });

  await createNotification({
    accountId: args.accountId,
    userId: args.agentUserId,
    type: 'new_message',
    eventKey: 'property_enquiry',
    title: args.referredByName
      ? `Enquiry via ${args.referredByName}: ${args.leadName}`
      : `Enquiry: ${args.leadName}`,
    body: args.enquiryText,
    entityType: 'conversation',
    entityId: args.conversationId,
    link: `/inbox?conversation=${args.conversationId}`,
    // The card is the WhatsApp ping. Only when it could not be
    // delivered does the plain text one stand in for it — and the
    // channel has to be forced off, not merely left without a text:
    // createNotification falls back to title+body on WhatsApp, which
    // put a second "Enquiry: …" bubble under the card on the very
    // first live run.
    ...(cardSent
      ? { channels: { inApp: true, push: true, whatsapp: false } }
      : {
          whatsappText: [
            '🔔 *New property enquiry*',
            `👤 ${args.leadName}`,
            ...(args.referredByName
              ? [`🤝 Referred by ${args.referredByName}`]
              : []),
            '',
            args.enquiryText,
            '',
            BRIDGE_REPLY_HINT,
          ].join('\n'),
        }),
  });
}
