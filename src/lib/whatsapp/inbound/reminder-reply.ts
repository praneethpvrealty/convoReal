import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
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
 * "Requesting reschedule" flags the appointment and pings the agent.
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
      .select('id, title, start_time, user_id, assigned_to')
      .maybeSingle();
    // Reminder tap on a since-deleted or since-re-armed appointment:
    // still consumed, nothing changed.
    if (!appt) return true;

    const formattedTime = new Date(appt.start_time).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

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

    const agentUserId = appt.assigned_to || appt.user_id;
    if (!agentUserId) return true;

    const { data: agentProfile } = await admin
      .from('profiles')
      .select('phone')
      .eq('user_id', agentUserId)
      .maybeSingle();
    if (!agentProfile?.phone) return true;
    const agentPhone = sanitizePhoneForMeta(agentProfile.phone);
    if (!isValidE164(agentPhone)) return true;

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: agentUserId,
      toPhone: agentPhone,
      kind: 'text',
      senderType: 'bot',
      text: isReschedule
        ? `🔄 Reschedule requested for "${appt.title}" on ${formattedTime}. The client tapped "Requesting reschedule" on their reminder — reach out to find a new time.`
        : `✅ Meeting confirmed: "${appt.title}" on ${formattedTime}. The client tapped "Fine" on their reminder.`,
    });
    return true;
  } catch (err) {
    console.error('[webhook] handleReminderButtonReply failed:', err);
    // The text matched a reminder button — swallow rather than letting
    // a partial failure leak the tap into the chatbot flows.
    return true;
  }
}
