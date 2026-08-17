import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildReminderTemplateContent,
  formatReminderTime,
  reminderLocationText,
  type ReminderProperty,
} from '@/lib/appointments/reminder';
import { canSendToEveryLead } from '@/lib/reengagement/template-gate';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  isValidE164,
  phonesMatch,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';
import {
  loadTemplateForContact,
  warnLanguageFallback,
} from '@/lib/whatsapp/template-language';

export const AGENT_MESSAGE_CONTACT_PREFIX = 'arm_msg:';

interface ManualReminderAppointment {
  id: string;
  account_id: string;
  user_id: string | null;
  assigned_to: string | null;
  title: string;
  event_type: string | null;
  start_time: string;
  location: string | null;
  status: string;
  contact_id: string | null;
  contact_ids: string[] | null;
  property: (ReminderProperty & { title?: string | null }) | null;
  account: { name: string | null } | null;
}

interface ManualReminderTemplate {
  name: string;
  language: string | null;
  status: string | null;
  category: string | null;
  body_text: string;
  buttons?: Array<Record<string, unknown>> | null;
}

export function buildAgentMessageContactReplyId(
  appointmentId: string,
  contactId: string
): string {
  return `${AGENT_MESSAGE_CONTACT_PREFIX}${appointmentId}:${contactId}`;
}

export function parseAgentMessageContactReplyId(
  replyId: string | null | undefined
): { appointmentId: string; contactId: string } | null {
  if (!replyId?.startsWith(AGENT_MESSAGE_CONTACT_PREFIX)) return null;
  const parts = replyId.slice(AGENT_MESSAGE_CONTACT_PREFIX.length).split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { appointmentId: parts[0], contactId: parts[1] };
}

export function agentMessageButtonTitle(
  name: string | null | undefined
): string {
  const firstName = name?.trim().split(/\s+/)[0] || 'contact';
  return Array.from(`Message ${firstName}`).slice(0, 20).join('');
}

async function acknowledgeAgent(args: {
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  text: string;
}): Promise<void> {
  await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'text',
    senderType: 'bot',
    text: args.text,
    allowDeadContact: true,
    customDbClient: args.admin,
  });
}

export async function handleAgentMessageContactReply(args: {
  admin: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  agentContactId: string;
  agentConversationId: string;
  replyId: string;
  senderPhone: string;
}): Promise<boolean> {
  const action = parseAgentMessageContactReplyId(args.replyId);
  if (!action) return false;

  const ack = (text: string) =>
    acknowledgeAgent({
      admin: args.admin,
      accountId: args.accountId,
      userId: args.ownerUserId,
      contactId: args.agentContactId,
      conversationId: args.agentConversationId,
      text,
    });

  try {
    const { data: appointmentRow } = await args.admin
      .from('appointments')
      .select(
        'id, account_id, user_id, assigned_to, title, event_type, start_time, location, status, contact_id, contact_ids, property:properties(id, title, type, location_privacy, location, sublocality, city, state), account:accounts(name)'
      )
      .eq('id', action.appointmentId)
      .eq('account_id', args.accountId)
      .maybeSingle();
    const appointment =
      appointmentRow as unknown as ManualReminderAppointment | null;
    if (!appointment || appointment.status !== 'scheduled') {
      await ack(
        'This appointment is no longer scheduled, so no message was sent.'
      );
      return true;
    }

    const recipientIds = new Set(appointment.contact_ids || []);
    if (appointment.contact_id) recipientIds.add(appointment.contact_id);
    if (!recipientIds.has(action.contactId)) {
      await ack('That contact is no longer attached to this appointment.');
      return true;
    }

    const assigneeId = appointment.assigned_to || appointment.user_id;
    if (!assigneeId) {
      await ack(
        'This appointment has no assigned team member, so no message was sent.'
      );
      return true;
    }

    const [{ data: profile }, { data: contact }] = await Promise.all([
      args.admin
        .from('profiles')
        .select('phone')
        .eq('account_id', args.accountId)
        .eq('user_id', assigneeId)
        .maybeSingle(),
      args.admin
        .from('contacts')
        .select('id, name, phone')
        .eq('account_id', args.accountId)
        .eq('id', action.contactId)
        .maybeSingle(),
    ]);

    if (!profile?.phone || !phonesMatch(profile.phone, args.senderPhone)) {
      await ack(
        'Only the team member assigned to this appointment can send this message.'
      );
      return true;
    }
    if (!contact?.phone || !isValidE164(sanitizePhoneForMeta(contact.phone))) {
      await ack('This contact does not have a valid WhatsApp number.');
      return true;
    }

    const isSiteVisit = appointment.event_type === 'site_visit';
    const content = buildReminderTemplateContent({
      clientName: contact.name || 'Client',
      accountName: appointment.account?.name || 'our team',
      title: appointment.property?.title || appointment.title || 'Appointment',
      formattedTime: formatReminderTime(appointment.start_time),
      locationText:
        appointment.event_type === 'call'
          ? 'Phone call'
          : reminderLocationText(appointment.location, appointment.property),
      isSiteVisit,
    });

    const { template, language, fellBack } =
      await loadTemplateForContact<ManualReminderTemplate>(args.admin, {
        accountId: args.accountId,
        contactId: contact.id,
        names: [content.templateName],
      });
    if (fellBack) {
      warnLanguageFallback(
        'Agent Reminder Action',
        args.accountId,
        language,
        template
      );
    }
    if (!template || !canSendToEveryLead(template)) {
      await ack(
        `I couldn't message ${contact.name || 'the contact'} because the ${content.templateName} Utility template is not approved. Approve it in Settings → WhatsApp Templates.`
      );
      return true;
    }

    const { error: claimError } = await args.admin
      .from('appointment_reminder_log')
      .insert({
        account_id: args.accountId,
        appointment_id: appointment.id,
        contact_id: contact.id,
        reminder_type: 'manual',
      });
    if (claimError?.code === '23505') {
      await ack(
        `${contact.name || 'This contact'} was already messaged from this reminder. The send remains tracked in ConvoReal.`
      );
      return true;
    }
    if (claimError) {
      await ack(
        'ConvoReal could not record this send, so no message was sent.'
      );
      return true;
    }

    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: assigneeId,
      contactId: contact.id,
      kind: 'template',
      senderType: 'agent',
      templateName: template.name,
      templateLanguage: template.language || 'en_US',
      templateParams: content.templateParams,
      templateRow: template,
      text: content.bodyText,
      customDbClient: args.admin,
    });
    if (!result.success) {
      await args.admin
        .from('appointment_reminder_log')
        .delete()
        .eq('appointment_id', appointment.id)
        .eq('contact_id', contact.id)
        .eq('reminder_type', 'manual');
      await ack(
        `I couldn't send the Utility message to ${contact.name || 'the contact'}. Please try again.`
      );
      return true;
    }

    if (result.whatsappMessageId) {
      await args.admin
        .from('appointment_reminder_log')
        .update({ wa_message_id: result.whatsappMessageId })
        .eq('appointment_id', appointment.id)
        .eq('contact_id', contact.id)
        .eq('reminder_type', 'manual');
    }

    await ack(
      `✅ Utility message sent to ${contact.name || 'the contact'} through ConvoReal. Delivery and replies are tracked in the Inbox and on this appointment.`
    );
    return true;
  } catch (error) {
    console.error('[Agent Reminder Action] failed:', error);
    await ack('I could not complete that send. Please try again.');
    return true;
  }
}
