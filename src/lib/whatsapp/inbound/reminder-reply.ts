import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatReminderTime, reminderTitle } from '@/lib/appointments/reminder';
import { reminderMemberIds } from '@/lib/calendar/reminder-members';
import type { WhatsAppMessage } from '@/lib/whatsapp/webhook-handler';

const REMINDER_RESCHEDULE_BUTTON_TEXT = 'Requesting reschedule';

const REMINDER_CONFIRM_BUTTON_TEXT = 'Fine';

/**
 * A tap on either of the reminder's quick-reply buttons
 * (supabase/migrations/141_reminder_reschedule_buttons.sql) arrives as
 * message.type === 'button' with context.id pointing at the original
 * outbound reminder — matched via the wa_message_id reminder.ts
 * stamps onto appointment_reminder_log after each send.
 *
 * "Requesting reschedule" flags the appointment, tells the client the
 * time is on hold, and pings every member who gets the appointment's
 * reminders with who asked and who else's reminders are now held: the
 * reminder cron sends nothing for a flagged appointment, to any
 * contact or liaison on it, until the time moves (which re-arms the
 * reminders and clears the flag) or a "Fine" tap clears it.
 * "Fine" stamps client_confirmed_at (migration 151), acks the client
 * in-thread, and pings the agent. Returns true when the tap belonged
 * to a reminder so the caller stops processing — before this, "Fine"
 * fell through as an ordinary message: silence for a client, and for
 * owner-phone senders the AI ingestion chatbot answered a meeting
 * confirmation with its welcome text.
 */
export async function handleReminderButtonReply(
  message: WhatsAppMessage,
  accountId: string,
  contactId: string,
  conversationId: string,
  ownerUserId: string
): Promise<boolean> {
  const buttonText = message.button?.text;
  const isReschedule = buttonText === REMINDER_RESCHEDULE_BUTTON_TEXT;
  const isConfirm = buttonText === REMINDER_CONFIRM_BUTTON_TEXT;
  if ((!isReschedule && !isConfirm) || !message.context?.id) return false;

  try {
    const admin = supabaseAdmin();
    const claimColumns =
      'appointment_id, rearmed_at, appointment:appointments(reminders_rearmed_at)';
    let { data: log } = await admin
      .from('appointment_reminder_log')
      .select(claimColumns)
      .eq('wa_message_id', message.context.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!log?.appointment_id) {
      // A reply to an earlier send of a claim the cron has since sent
      // again (src/lib/appointments/claim-confirm.ts).
      ({ data: log } = await admin
        .from('appointment_reminder_log')
        .select(claimColumns)
        .contains('prior_wa_message_ids', [message.context.id])
        .eq('account_id', accountId)
        .maybeSingle());
    }
    if (!log?.appointment_id) return false;
    // A tap on a reminder for a time or a state the appointment no
    // longer has (it was moved, closed or reopened since — a new
    // generation) is acknowledged as belonging to a reminder but
    // changes nothing: the fresh reminders collect a fresh answer.
    const appointmentRow = Array.isArray(log.appointment)
      ? log.appointment[0]
      : log.appointment;
    const claimGeneration = log.rearmed_at
      ? new Date(log.rearmed_at).getTime()
      : null;
    const currentGeneration = appointmentRow?.reminders_rearmed_at
      ? new Date(appointmentRow.reminders_rearmed_at).getTime()
      : null;
    if (claimGeneration !== currentGeneration) {
      console.log(
        `[Reminder Reply] Ignoring a ${isReschedule ? 'reschedule' : 'confirmation'} tap on a reminder from an earlier generation of appointment ${log.appointment_id}`
      );
      return true;
    }

    // Each tap resolves the other flag — the latest client signal wins.
    const stamp = isReschedule
      ? {
          reschedule_requested_at: new Date().toISOString(),
          client_confirmed_at: null,
        }
      : {
          client_confirmed_at: new Date().toISOString(),
          reschedule_requested_at: null,
        };

    // The generation is a predicate of the write itself, so a re-arm
    // landing between the check above and this update makes the
    // update miss rather than land on the new generation.
    const stampQuery = admin
      .from('appointments')
      .update(stamp)
      .eq('id', log.appointment_id)
      .eq('account_id', accountId);
    const { data: appt } = await (
      log.rearmed_at
        ? stampQuery.eq('reminders_rearmed_at', log.rearmed_at)
        : stampQuery.is('reminders_rearmed_at', null)
    )
      .select(
        'id, title, start_time, event_type, user_id, assigned_to, remind_creator, contact_id, contact_ids, remind_liaison, liaison:liaisons(name), property:properties(title)'
      )
      .maybeSingle();
    // Reminder tap on a since-deleted or since-re-armed appointment:
    // still consumed, nothing changed.
    if (!appt) return true;

    const formattedTime = formatReminderTime(appt.start_time);
    const property = Array.isArray(appt.property)
      ? appt.property[0]
      : appt.property;
    const isSiteVisit = appt.event_type === 'site_visit';
    const title = reminderTitle(
      { title: appt.title, property: property ?? null },
      isSiteVisit
    );

    if (isReschedule) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: ownerUserId,
        contactId,
        conversationId,
        kind: 'text',
        senderType: 'bot',
        text: rescheduleAckText({ title, formattedTime, isSiteVisit }),
      });
    }

    if (isConfirm) {
      // Ack in-thread — the client just messaged, so the 24h session
      // window is open for free-form text.
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: ownerUserId,
        contactId,
        conversationId,
        kind: 'text',
        senderType: 'bot',
        text: `✅ Thank you! Your meeting "${appt.title}" on ${formattedTime} is confirmed. See you there!`,
      });
    }

    const runner = appt.assigned_to || appt.user_id;
    const memberIds = isReschedule
      ? [...new Set([...(runner ? [runner] : []), ...reminderMemberIds(appt)])]
      : runner
        ? [runner]
        : [];
    if (memberIds.length === 0) return true;

    let agentText = `✅ Meeting confirmed: "${appt.title}" on ${formattedTime}. The client tapped "Fine" on their reminder.`;
    if (isReschedule) {
      const contactIds = [
        ...new Set([
          ...((appt.contact_ids as string[] | null) || []),
          ...(appt.contact_id ? [appt.contact_id] : []),
          contactId,
        ]),
      ];
      const { data: people } = await admin
        .from('contacts')
        .select('id, name, phone')
        .eq('account_id', accountId)
        .in('id', contactIds);
      const nameOf = (c: { name: string | null; phone: string | null }) =>
        c.name?.trim() || c.phone || 'a contact';
      const requester = (people || []).find((c) => c.id === contactId);
      const others = (people || [])
        .filter((c) => c.id !== contactId)
        .map(nameOf);
      const liaison = Array.isArray(appt.liaison)
        ? appt.liaison[0]
        : appt.liaison;
      if (appt.remind_liaison && liaison) {
        others.push(liaison.name?.trim() || 'the liaison');
      }
      agentText = rescheduleAgentText({
        title: appt.title,
        formattedTime,
        requester: requester ? nameOf(requester) : 'The client',
        others,
      });
    }

    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, phone')
      .in('user_id', memberIds);
    for (const memberId of memberIds) {
      const phone = (profiles || []).find((p) => p.user_id === memberId)?.phone;
      if (!phone) continue;
      const agentPhone = sanitizePhoneForMeta(phone);
      if (!isValidE164(agentPhone)) continue;
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: memberId,
        toPhone: agentPhone,
        kind: 'text',
        senderType: 'bot',
        text: agentText,
      });
    }
    return true;
  } catch (err) {
    console.error('[webhook] handleReminderButtonReply failed:', err);
    // The text matched a reminder button — swallow rather than letting
    // a partial failure leak the tap into the chatbot flows.
    return true;
  }
}

export function rescheduleAckText(args: {
  title: string;
  formattedTime: string;
  isSiteVisit: boolean;
}): string {
  const what = args.isSiteVisit
    ? `property visit for "${args.title}"`
    : `meeting "${args.title}"`;
  return `🔄 Noted! Your ${what} on ${args.formattedTime} is on hold, so you won't get more reminders for that time. We'll be in touch shortly to fix a new time that suits you.`;
}

export function rescheduleAgentText(args: {
  title: string;
  formattedTime: string;
  requester: string;
  others: string[];
}): string {
  const held =
    args.others.length > 0
      ? `Reminders for this time are on hold for everyone on it, including ${args.others.join(', ')}. Move the event to the new time and choose to notify all participants so they hear about it.`
      : 'The remaining reminders for this time are on hold until you move the event.';
  return `🔄 Reschedule requested for "${args.title}" on ${args.formattedTime}. ${args.requester} tapped "Requesting reschedule" on their reminder — reach out to find a new time. ${held}`;
}
