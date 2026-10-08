import type { SupabaseClient } from '@supabase/supabase-js';
import { unavailableListingReplyWithShowcase } from '@/lib/inventory/unavailable-reply';
import { createNotification } from '@/lib/notifications/create';
import { resolveAssignedAgent } from '@/lib/voice/assigned-agent';
import { handleListingFeedbackReply } from '@/lib/whatsapp/listing-feedback';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  parseViewNudgeReplyId,
  viewNudgeFirstName,
  type ViewNudgeChoice,
} from '@/lib/showcase/view-nudge-template';

export const VIEW_NUDGE_TODO_DUE_MS: Record<
  Exclude<ViewNudgeChoice, 'not_for_me'>,
  number
> = {
  callback: 60 * 60 * 1000,
  visit: 3 * 60 * 60 * 1000,
};

export function buildViewNudgeAck(
  choice: Exclude<ViewNudgeChoice, 'not_for_me'>,
  args: { firstName: string; propertyTitle: string; agentName: string | null }
): string {
  const who = args.agentName || 'Our team';
  if (choice === 'callback') {
    return `Thanks ${args.firstName}! ${who} will call you back shortly about *${args.propertyTitle}*. If there's a better time to reach you, just reply here.`;
  }
  return `Great choice, ${args.firstName}! ${who} will get in touch to fix a time to see *${args.propertyTitle}*. Reply with a day and time that suits you and we'll plan around it.`;
}

export function buildViewNudgeAgentAlert(
  choice: Exclude<ViewNudgeChoice, 'not_for_me'>,
  args: {
    contactName: string;
    contactPhone: string;
    propertyTitle: string;
    ackFailed?: boolean;
  }
): { title: string; body: string } {
  const unconfirmed = args.ackFailed
    ? " Our WhatsApp confirmation to them didn't go through, so reach out directly."
    : '';
  if (choice === 'callback') {
    return {
      title: `Call back ${args.contactName}`,
      body: `${args.contactName} (${args.contactPhone}) viewed ${args.propertyTitle} on your showcase and asked for a call back. Call them within the hour.${unconfirmed}`,
    };
  }
  return {
    title: `${args.contactName} wants to visit a listing`,
    body: `${args.contactName} (${args.contactPhone}) viewed ${args.propertyTitle} on your showcase and tapped "Book a visit". Reply here to fix a time.${unconfirmed}`,
  };
}

export function buildViewNudgeNotOpenReply(
  firstName: string,
  propertyTitle: string
): string {
  return `Thanks ${firstName}! *${propertyTitle}* isn't open for visits or calls right now. I'll let you know as soon as it is, and our team can share similar options meanwhile.`;
}

export async function handleViewNudgeReply(args: {
  db: SupabaseClient;
  accountId: string;
  configOwnerUserId: string;
  contact: { id: string; name?: string | null; phone?: string | null };
  conversationId: string;
  replyId: string;
}): Promise<boolean> {
  const parsed = parseViewNudgeReplyId(args.replyId);
  if (!parsed) return false;
  const { db, accountId, configOwnerUserId, contact, conversationId } = args;
  const { choice, propertyId } = parsed;

  const { data: property } = await db
    .from('properties')
    .select('id, title, user_id, status')
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!property) return false;

  const { data: nudge } = await db
    .from('showcase_view_nudges')
    .select('id, response')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .eq('property_id', propertyId)
    .maybeSingle();
  const repeatTap = nudge?.response === choice;
  const recordResponse = async () => {
    if (!nudge || repeatTap) return;
    const { error } = await db
      .from('showcase_view_nudges')
      .update({ response: choice, responded_at: new Date().toISOString() })
      .eq('id', nudge.id)
      .eq('account_id', accountId);
    if (error) {
      console.error('[view-nudge-reply] response not recorded:', error);
    }
  };

  if (choice === 'not_for_me') {
    const handled = await handleListingFeedbackReply({
      db,
      accountId,
      configOwnerUserId,
      contact,
      conversationId,
      replyId: `lfb_n_${propertyId}`,
    });
    if (handled) await recordResponse();
    return handled;
  }

  if (property.status !== 'Available') {
    const unavailable = await unavailableListingReplyWithShowcase({
      db,
      accountId,
      contactId: contact.id,
      contactName: contact.name,
      propertyTitle: property.title as string | null,
      status: property.status as string | null,
    });
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contact.id,
      conversationId,
      kind: 'text',
      senderType: 'bot',
      text:
        unavailable ??
        buildViewNudgeNotOpenReply(
          viewNudgeFirstName(contact.name),
          (property.title as string | null) || 'this property'
        ),
      customDbClient: db,
    });
    return true;
  }

  const propertyTitle = (property.title as string | null) || 'this property';
  const { data: contactRow } = await db
    .from('contacts')
    .select('assigned_agent_id, phone')
    .eq('id', contact.id)
    .eq('account_id', accountId)
    .maybeSingle();
  const agentUserId =
    (contactRow?.assigned_agent_id as string | null) ??
    (property.user_id as string | null) ??
    configOwnerUserId;
  const agent = await resolveAssignedAgent(db, accountId, agentUserId).catch(
    () => null
  );

  const ack = await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: contact.id,
    conversationId,
    kind: 'text',
    senderType: 'bot',
    text: buildViewNudgeAck(choice, {
      firstName: viewNudgeFirstName(contact.name),
      propertyTitle,
      agentName: agent?.name?.split(/\s+/)[0] || null,
    }),
    customDbClient: db,
  }).catch((err: unknown) => {
    console.error('[view-nudge-reply] acknowledgement failed:', err);
    return null;
  });
  const ackFailed = !ack || ack.success === false;
  if (ackFailed && ack) {
    console.error('[view-nudge-reply] acknowledgement not sent:', ack.error);
  }

  const { error: feedbackError } = await db.from('listing_feedback').upsert(
    {
      account_id: accountId,
      contact_id: contact.id,
      property_id: propertyId,
      verdict: 'interested',
      reason: null,
    },
    { onConflict: 'contact_id,property_id' }
  );
  if (feedbackError) {
    console.error('[view-nudge-reply] interest not recorded:', feedbackError);
  }

  if (repeatTap) return true;

  const contactName = contact.name?.trim() || 'A lead';
  const contactPhone =
    (contactRow?.phone as string | null) || contact.phone || 'no number';
  const { error: todoError } = await db.from('todos').insert({
    account_id: accountId,
    user_id: configOwnerUserId,
    assigned_to: agentUserId,
    title:
      choice === 'callback'
        ? `Call back ${contactName} about ${propertyTitle}`
        : `Fix a site visit with ${contactName} for ${propertyTitle}`,
    due_date: new Date(
      Date.now() + VIEW_NUDGE_TODO_DUE_MS[choice]
    ).toISOString(),
    priority: 'high',
    completed: false,
    contact_id: contact.id,
    source: 'system',
  });
  if (todoError) {
    console.error('[view-nudge-reply] to-do insert failed:', todoError);
  }

  const alert = buildViewNudgeAgentAlert(choice, {
    contactName,
    contactPhone,
    propertyTitle,
    ackFailed,
  });
  await createNotification({
    accountId,
    userId: agentUserId,
    type: 'listing_interest',
    eventKey: 'showcase_viewer_response',
    title: alert.title,
    body: alert.body,
    entityType: 'conversation',
    entityId: conversationId,
    link: `/inbox?conversation=${conversationId}`,
  });
  if (!todoError) await recordResponse();
  return true;
}
