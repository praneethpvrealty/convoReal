import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logText } from '@/lib/whatsapp/inbound/log-text';
import type { InboundChainContext, StepResult } from '../context';

export async function calendarQuery(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accessToken,
    phoneNumberId,
    senderPhone,
    contentText,
    contactRecord,
    conversation,
  } = ctx;

  const cleanedText = contentText?.trim()?.toLowerCase() || '';
  const isCalendarQuery =
    /\b(schedule|visit|appointment|appointments|booking|bookings|my visits|my appointments)\b/i.test(
      cleanedText
    );

  if (isCalendarQuery) {
    console.log(
      `[webhook] Calendar schedule query detected from contact: ${contactRecord.id} (${logText(senderPhone)})`
    );

    const nowIso = new Date().toISOString();
    const { data: appointments, error: apptError } = await supabaseAdmin()
      .from('appointments')
      .select('*, property:properties(title, location, sublocality)')
      .eq('contact_id', contactRecord.id)
      .eq('status', 'scheduled')
      .gte('start_time', nowIso)
      .order('start_time', { ascending: true });

    let replyText = '';
    if (apptError) {
      console.error(
        '[webhook] Error fetching appointments for auto-reply:',
        apptError
      );
      replyText = `Sorry, I encountered an error checking your schedule. Please try again later or contact your agent.`;
    } else if (!appointments || appointments.length === 0) {
      replyText = `Hi ${contactRecord.name || 'there'},\n\nYou have no upcoming property visits or appointments scheduled at the moment.`;
    } else {
      replyText = `Hi ${contactRecord.name || 'there'},\n\nHere are your upcoming scheduled visits:\n\n`;

      appointments.forEach(
        (
          appt: {
            start_time: string;
            title: string;
            location?: string | null;
            property?: {
              title?: string | null;
              location?: string | null;
              sublocality?: string | null;
            } | null;
          },
          idx: number
        ) => {
          const dateStr = new Date(appt.start_time).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short',
          });
          const propTitle = appt.property?.title
            ? `🏡 *${appt.property.title}*`
            : '🏡 *Property Details*';
          const locationStr =
            appt.location ||
            appt.property?.location ||
            appt.property?.sublocality ||
            'Not specified';

          replyText += `${idx + 1}. 📅 *${appt.title}*\n${propTitle}\n📍 Location: ${locationStr}\n⏰ Time: ${dateStr}\n\n`;
        }
      );

      replyText += `Please contact us if you need to reschedule any of these visits!`;
    }

    try {
      const sendRes = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: senderPhone,
        text: replyText,
      });

      await supabaseAdmin().from('messages').insert({
        conversation_id: conversation.id,
        sender_type: 'bot',
        content_type: 'text',
        content_text: replyText,
        message_id: sendRes.messageId,
        status: 'sent',
        created_at: new Date().toISOString(),
      });

      await supabaseAdmin()
        .from('conversations')
        .update({
          last_message_text: replyText,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          awaiting_reply: false,
        })
        .eq('id', conversation.id);

      console.log(
        `[webhook] Automated calendar reply successfully sent to ${logText(senderPhone)}`
      );
    } catch (sendErr) {
      console.error(
        '[webhook] Failed to send automated calendar reply:',
        sendErr
      );
    }

    return 'handled';
  }
  return 'continue';
}
