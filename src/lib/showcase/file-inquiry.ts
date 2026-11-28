import type { SupabaseClient } from '@supabase/supabase-js';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';
import { attachIdentifiedSession } from '@/lib/pulse/visitor-identity';

export interface ShowcaseInquiryProperty {
  id: string;
  title: string;
  property_code: string | null;
}

export interface ShowcaseInquiryInput {
  accountId: string;
  phone: string;
  normalizedPhone: string;
  name: string | null;
  email: string | null;
  message: string | null;
  isAiAgent: boolean;
  isShortlist: boolean;
  propertyId: string | null;
  propertyTitle: string | null;
  propertyCode: string | null;
  shortlistProperties: ShowcaseInquiryProperty[];
  targetAgentUserId: string;
  referrerContactId: string | null;
  sessionKey: string | null;
}

export class InquiryContactError extends Error {}

function shortlistSummaryOf(properties: ShowcaseInquiryProperty[]): string {
  return properties
    .map(
      (property, index) =>
        `${index + 1}. ${property.title}${property.property_code ? ` (${property.property_code})` : ''} [${property.id}]`
    )
    .join('\n');
}

/**
 * Files a showcase enquiry on the listing account: the lead, the
 * enquiry on each listing, a note, a follow-up task and the inbox
 * message. Called by /api/public/inquiry at once for a direct visitor,
 * and by the referred-enquiry flow only after the agent whose link the
 * visitor came through has approved.
 */
export async function fileShowcaseInquiry(
  admin: SupabaseClient,
  input: ShowcaseInquiryInput
): Promise<{ contactId: string }> {
  const {
    accountId,
    phone,
    normalizedPhone,
    name,
    email,
    message,
    isAiAgent,
    isShortlist,
    propertyId,
    propertyTitle,
    propertyCode,
    shortlistProperties,
    targetAgentUserId,
    sessionKey,
  } = input;
  const channelLabel = isAiAgent ? 'AI Agent' : 'Website';
  const shortlistSummary = shortlistSummaryOf(shortlistProperties);

  let contactId: string;
  try {
    const result = await findOrCreateContact(admin, {
      accountId,
      userId: targetAgentUserId,
      phone: normalizedPhone,
      name: name || `${channelLabel} Lead`,
      email: email || null,
      classification: 'Buyer',
      referrer: isAiAgent ? 'AI Agent' : 'Website Showcase',
      referrerContactId: input.referrerContactId,
      lastInquiredPropertyId: propertyId || null,
    });
    contactId = result.contactId;
  } catch (err) {
    throw new InquiryContactError(
      err instanceof Error ? err.message : 'Contact find-or-create failed'
    );
  }

  if (shortlistProperties.length) {
    const { error: inquiryError } = await admin
      .from('contact_property_inquiries')
      .upsert(
        shortlistProperties.map((property) => ({
          account_id: accountId,
          contact_id: contactId,
          property_id: property.id,
          inquiry_source: 'Website Shortlist',
        })),
        { onConflict: 'contact_id,property_id', ignoreDuplicates: true }
      );
    if (inquiryError) throw inquiryError;
    const { error: markerError } = await admin
      .from('contact_property_inquiries')
      .update({ via_portal_link: false })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .in(
        'property_id',
        shortlistProperties.map((property) => property.id)
      )
      .eq('via_portal_link', true);
    if (markerError) throw markerError;
  }

  // Retroactive stitching: this visitor just revealed who they are, so
  // their earlier "Anonymous Guest" Pulse events from the same browser
  // session (tracked via the same showcase_session_key in localStorage)
  // can now show up under their name, and this browser becomes one of
  // their known devices for later visits.
  if (sessionKey?.trim()) {
    await attachIdentifiedSession(
      admin,
      { accountId, contactId, sessionKey },
      '[POST /api/public/inquiry]'
    );
  }

  let noteText = `${channelLabel} Inquiry received:\n`;
  if (shortlistSummary)
    noteText += `• Selected properties:\n${shortlistSummary}\n`;
  if (propertyTitle) {
    noteText += `• Interested in Property: ${propertyTitle}\n`;
  }
  if (propertyCode) {
    noteText += `• Property Code: ${propertyCode}\n`;
  }
  if (propertyId) {
    noteText += `• Property ID: ${propertyId}\n`;
  }
  if (message) {
    noteText += `• Message: ${message.trim()}\n`;
  } else {
    noteText += `• Message: (No message provided)\n`;
  }

  const { error: noteError } = await admin.from('contact_notes').insert([
    {
      account_id: accountId,
      contact_id: contactId,
      user_id: targetAgentUserId,
      note_text: noteText,
    },
  ]);

  if (noteError) {
    if (isShortlist) throw noteError;
    console.error(
      '[POST /api/public/inquiry] Contact note creation failed:',
      noteError
    );
  }

  const { error: todoError } = await admin.from('todos').insert([
    {
      account_id: accountId,
      user_id: targetAgentUserId,
      title: `New ${channelLabel} Inquiry - @${name || phone}`,
      description: `Visitor ${name || ''} (${phone}) inquired about property: "${propertyTitle || 'Unknown'}"${propertyCode ? ` (${propertyCode})` : ''}.${shortlistSummary ? `\n${shortlistSummary}\n` : ' '}Review contact and follow up.`,
      due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      priority: 'high',
      completed: false,
      contact_id: contactId,
      property_id: propertyId || null,
    },
  ]);

  if (todoError) {
    console.error(
      '[POST /api/public/inquiry] Todo creation failed:',
      todoError
    );
  }

  try {
    const { data: existingConv, error: findConvError } = await admin
      .from('conversations')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle();

    let conversationId: string | undefined;
    let currentUnreadCount = 0;

    if (!findConvError && existingConv) {
      conversationId = existingConv.id;
      currentUnreadCount = existingConv.unread_count || 0;
    } else {
      const { data: newConv, error: createConvError } = await admin
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: targetAgentUserId,
          contact_id: contactId,
          unread_count: 0,
        })
        .select()
        .single();

      if (createConvError) {
        console.error(
          '[POST /api/public/inquiry] Conversation creation failed:',
          createConvError
        );
      }
      conversationId = newConv?.id;
    }

    if (conversationId) {
      let inboxText = `📩 *${channelLabel} Inquiry Received*\n\n`;
      if (shortlistSummary)
        inboxText += `🏘️ *Selected properties*:\n${shortlistSummary}\n\n`;
      if (propertyTitle) {
        inboxText += `🏡 *Property*: ${propertyTitle}${propertyCode ? ` (${propertyCode})` : ''}\n`;
      }
      if (message) {
        inboxText += `💬 *Message*: ${message.trim()}\n`;
      }
      if (email) {
        inboxText += `📧 *Email*: ${email.trim().toLowerCase()}\n`;
      }
      inboxText += `👤 *Name*: ${name || `${channelLabel} Lead`}\n📞 *Phone*: ${normalizedPhone}`;

      const { error: msgInsertError } = await admin.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        private: true,
        content_type: 'text',
        content_text: inboxText,
        message_id: `${isAiAgent ? 'ai-agent' : 'web'}-inquiry-${Date.now()}`,
        status: 'delivered',
        created_at: new Date().toISOString(),
      });

      if (msgInsertError) {
        console.error(
          '[POST /api/public/inquiry] Inbox message insertion failed:',
          msgInsertError
        );
      } else {
        await admin
          .from('conversations')
          .update({
            last_message_text: inboxText,
            last_message_at: new Date().toISOString(),
            unread_count: currentUnreadCount + 1,
            awaiting_reply: true,
            // Not `last_customer_message_at`: filling in a web form
            // does not open Meta's 24-hour free-form window, and
            // stamping it here both invented a window for a lead who
            // has never messaged and extended it past the truth for
            // one who had. The thread still needs a reply either way.
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId);
      }
    }
  } catch (inboxErr) {
    console.error(
      '[POST /api/public/inquiry] Failed to route inquiry to inbox:',
      inboxErr
    );
  }

  return { contactId };
}
